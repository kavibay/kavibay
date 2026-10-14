//! Heart Rate: the latest bpm from a Bluetooth LE heart-rate sensor.
//!
//! Any device that broadcasts the standard Heart Rate Service (0x180D) works —
//! a chest strap, or a Fitbit Air with "Share heart rate" on in the Google
//! Health app. The cloud route only delivers after the phone syncs; this is the
//! one path that is live.
//!
//! LAZY, AND IT STOPS. Nothing touches the radio until a widget reads
//! `heart_rate_latest`. The first read starts one background thread that finds
//! the sensor, subscribes to its notifications and keeps the newest value here.
//! When nobody has read for `IDLE_STOP`, the thread lets go of the device so
//! the band is not kept connected (and draining) for a widget nobody shows.

use super::ExtensionRust;
use serde::Serialize;

/// The uniform entry point. No network host: the data comes over the radio.
pub const EXTENSION: ExtensionRust = ExtensionRust {
    folder: "heart-rate",
    capabilities: &[],
};

#[derive(Serialize, Clone, Copy, Default, Debug, PartialEq)]
pub struct HeartRateReading {
    /// Beats per minute; None before the first notification or while the
    /// sensor reports no skin contact.
    pub bpm: Option<u16>,
    /// When `bpm` arrived, ms since the Unix epoch.
    pub at: Option<u64>,
    /// Subscribed to a sensor right now.
    pub connected: bool,
}

/// Parses a Heart Rate Measurement (0x2A37) value into bpm.
///
/// Flags bit 0 picks an 8- or 16-bit (little-endian) value. Bits 1–2 are sensor
/// contact: "supported but not detected" is a band off the wrist, which still
/// notifies — with a value that is not a pulse, so it reads as None. Energy
/// expended and RR intervals follow and are ignored.
pub fn parse_measurement(data: &[u8]) -> Option<u16> {
    let flags = *data.first()?;
    let contact_supported = flags & 0b100 != 0;
    let contact_detected = flags & 0b010 != 0;
    if contact_supported && !contact_detected {
        return None;
    }
    if flags & 1 == 0 {
        data.get(1).map(|&b| u16::from(b))
    } else {
        Some(u16::from_le_bytes([*data.get(1)?, *data.get(2)?]))
    }
}

#[tauri::command]
pub fn heart_rate_latest() -> HeartRateReading {
    #[cfg(windows)]
    return windows_ble::latest();
    #[cfg(not(windows))]
    HeartRateReading::default()
}

#[cfg(windows)]
mod windows_ble {
    use super::{parse_measurement, HeartRateReading};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::sync::Mutex;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use windows::core::GUID;
    use windows::Devices::Bluetooth::Advertisement::{
        BluetoothLEAdvertisementReceivedEventArgs, BluetoothLEAdvertisementWatcher,
        BluetoothLEScanningMode,
    };
    use windows::Devices::Bluetooth::GenericAttributeProfile::{
        GattCharacteristic, GattClientCharacteristicConfigurationDescriptorValue,
        GattCommunicationStatus, GattDeviceService, GattValueChangedEventArgs,
    };
    use windows::Devices::Bluetooth::{
        BluetoothConnectionStatus, BluetoothLEDevice, BluetoothUuidHelper,
    };
    use windows::Devices::Enumeration::DeviceInformation;
    use windows::Foundation::TypedEventHandler;
    use windows::Storage::Streams::DataReader;

    const HEART_RATE_SERVICE: u32 = 0x180D;
    const HEART_RATE_MEASUREMENT: u32 = 0x2A37;
    /// No read for this long and the thread disconnects. A subscribed widget
    /// reads every second, so this is "the widget stopped watching" (switched
    /// off, closed) plus slack. Kept short because a connection held for
    /// nobody costs the band's battery.
    const IDLE_STOP: Duration = Duration::from_secs(10);
    /// How long one advertisement scan waits before trying again.
    const SCAN_WINDOW: Duration = Duration::from_secs(10);
    /// A sensor that stops notifying for this long is treated as gone even if
    /// Windows still calls it connected (it often does, for a while).
    const SILENT_RECONNECT: Duration = Duration::from_secs(30);

    struct Live {
        reading: HeartRateReading,
        last_value: Option<Instant>,
        last_read: Instant,
    }

    static LIVE: Mutex<Option<Live>> = Mutex::new(None);
    static RUNNING: AtomicBool = AtomicBool::new(false);

    fn with_live<R>(f: impl FnOnce(&mut Live) -> R) -> R {
        let mut guard = LIVE.lock().unwrap_or_else(|e| e.into_inner());
        let live = guard.get_or_insert_with(|| Live {
            reading: HeartRateReading::default(),
            last_value: None,
            last_read: Instant::now(),
        });
        f(live)
    }

    pub fn latest() -> HeartRateReading {
        let reading = with_live(|live| {
            live.last_read = Instant::now();
            live.reading
        });
        if !RUNNING.swap(true, Ordering::SeqCst) {
            std::thread::spawn(run);
        }
        reading
    }

    fn idle() -> bool {
        with_live(|live| live.last_read.elapsed() > IDLE_STOP)
    }

    fn set_connected(connected: bool) {
        with_live(|live| {
            live.reading.connected = connected;
            if connected {
                live.last_value = Some(Instant::now());
            }
        });
    }

    fn run() {
        loop {
            while !idle() {
                match subscribe() {
                    Ok((device, characteristic, token)) => {
                        set_connected(true);
                        loop {
                            std::thread::sleep(Duration::from_secs(1));
                            let silent = with_live(|live| {
                                live.last_value
                                    .is_some_and(|at| at.elapsed() > SILENT_RECONNECT)
                            });
                            let gone = device.ConnectionStatus().ok()
                                != Some(BluetoothConnectionStatus::Connected);
                            if idle() || silent || gone {
                                break;
                            }
                        }
                        let _ = characteristic.RemoveValueChanged(token);
                        let _ = device.Close();
                        set_connected(false);
                    }
                    // Not found, or the band refused: wait a beat and look again.
                    Err(_) => std::thread::sleep(Duration::from_secs(3)),
                }
            }
            RUNNING.store(false, Ordering::SeqCst);
            // A read between the last idle check and the store above saw
            // RUNNING still set and spawned nothing; this thread takes it.
            if idle() || RUNNING.swap(true, Ordering::SeqCst) {
                return;
            }
        }
    }

    /// Finds a heart-rate service and subscribes to its measurement.
    ///
    /// A sensor already paired with Windows does not advertise while it is
    /// connected, so the paired list is asked first; otherwise an
    /// advertisement naming the service is waited for.
    fn subscribe() -> windows::core::Result<(BluetoothLEDevice, GattCharacteristic, i64)> {
        let service_uuid = BluetoothUuidHelper::FromShortId(HEART_RATE_SERVICE)?;
        let service = match paired_service(service_uuid)? {
            Some(service) => service,
            None => advertised_service(service_uuid)?,
        };
        let device = service.Device()?;
        let measurement = BluetoothUuidHelper::FromShortId(HEART_RATE_MEASUREMENT)?;
        let result = service
            .GetCharacteristicsForUuidAsync(measurement)?
            .join()?;
        if result.Status()? != GattCommunicationStatus::Success {
            return Err(windows::core::Error::empty());
        }
        let characteristic = result.Characteristics()?.GetAt(0)?;
        let token = characteristic.ValueChanged(&TypedEventHandler::new(
            |_, args: windows::core::Ref<GattValueChangedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    let reader = DataReader::FromBuffer(&args.CharacteristicValue()?)?;
                    let mut bytes = vec![0u8; reader.UnconsumedBufferLength()? as usize];
                    reader.ReadBytes(&mut bytes)?;
                    record(parse_measurement(&bytes));
                }
                Ok(())
            },
        ))?;
        let status = characteristic
            .WriteClientCharacteristicConfigurationDescriptorAsync(
                GattClientCharacteristicConfigurationDescriptorValue::Notify,
            )?
            .join()?;
        if status != GattCommunicationStatus::Success {
            let _ = characteristic.RemoveValueChanged(token);
            return Err(windows::core::Error::empty());
        }
        Ok((device, characteristic, token))
    }

    fn record(bpm: Option<u16>) {
        let at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .ok();
        with_live(|live| {
            live.last_value = Some(Instant::now());
            live.reading.bpm = bpm;
            live.reading.at = at;
        });
    }

    fn paired_service(uuid: GUID) -> windows::core::Result<Option<GattDeviceService>> {
        let selector = GattDeviceService::GetDeviceSelectorFromUuid(uuid)?;
        let found = DeviceInformation::FindAllAsyncAqsFilter(&selector)?.join()?;
        for info in found {
            if let Ok(service) = GattDeviceService::FromIdAsync(&info.Id()?)?.join() {
                return Ok(Some(service));
            }
        }
        Ok(None)
    }

    fn advertised_service(uuid: GUID) -> windows::core::Result<GattDeviceService> {
        let watcher = BluetoothLEAdvertisementWatcher::new()?;
        watcher.SetScanningMode(BluetoothLEScanningMode::Active)?;
        watcher
            .AdvertisementFilter()?
            .Advertisement()?
            .ServiceUuids()?
            .Append(uuid)?;
        let (tx, rx) = mpsc::channel::<u64>();
        let tx = Mutex::new(tx);
        watcher.Received(&TypedEventHandler::new(
            move |_, args: windows::core::Ref<BluetoothLEAdvertisementReceivedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    let _ = tx
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .send(args.BluetoothAddress()?);
                }
                Ok(())
            },
        ))?;
        watcher.Start()?;
        let address = rx.recv_timeout(SCAN_WINDOW);
        let _ = watcher.Stop();
        let address = address.map_err(|_| windows::core::Error::empty())?;
        let device = BluetoothLEDevice::FromBluetoothAddressAsync(address)?.join()?;
        let services = device.GetGattServicesForUuidAsync(uuid)?.join()?;
        if services.Status()? != GattCommunicationStatus::Success {
            return Err(windows::core::Error::empty());
        }
        services.Services()?.GetAt(0)
    }
}

#[cfg(test)]
mod tests {
    use super::parse_measurement;

    #[test]
    fn eight_bit_value() {
        assert_eq!(parse_measurement(&[0x00, 72]), Some(72));
    }

    #[test]
    fn sixteen_bit_value_is_little_endian() {
        assert_eq!(parse_measurement(&[0x01, 0x2C, 0x01]), Some(300));
    }

    #[test]
    fn contact_detected_reads_and_trailing_fields_are_ignored() {
        // contact supported + detected, RR interval present (0x10)
        assert_eq!(parse_measurement(&[0b1_0110, 61, 0x00, 0x04]), Some(61));
    }

    #[test]
    fn off_the_wrist_is_none() {
        assert_eq!(parse_measurement(&[0b100, 0]), None);
    }

    #[test]
    fn truncated_value_is_none() {
        assert_eq!(parse_measurement(&[]), None);
        assert_eq!(parse_measurement(&[0x00]), None);
        assert_eq!(parse_measurement(&[0x01, 0x40]), None);
    }
}
