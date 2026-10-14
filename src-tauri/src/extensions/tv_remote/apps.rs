//! The apps the widget can start, and how each device names them.
//!
//! A closed list on purpose: the webview sends an app name, never an id or a
//! link, so it cannot make the TV open an arbitrary URL.

pub struct App {
    pub name: &'static str,
    /// Samsung's Tizen app id, as `/api/v2/applications/<id>` reports it.
    pub samsung: &'static str,
    /// A deep link the app itself handles on Android TV. Launching by package
    /// (`market://launch?id=…`) is refused by the waipu.tv stick, and a Play
    /// Store change broke it on other devices too.
    pub android: &'static str,
}

pub const APPS: &[App] = &[
    App {
        name: "youtube",
        samsung: "111299001912",
        android: "https://www.youtube.com",
    },
    App {
        name: "netflix",
        samsung: "3201907018807",
        android: "netflix://",
    },
    App {
        name: "primeVideo",
        samsung: "3201910019365",
        android: "https://app.primevideo.com",
    },
    App {
        name: "disneyPlus",
        samsung: "3201901017640",
        android: "https://www.disneyplus.com",
    },
    App {
        name: "spotify",
        samsung: "3201606009684",
        android: "spotify://",
    },
    App {
        name: "appleTv",
        samsung: "3201807016597",
        android: "https://tv.apple.com",
    },
];

pub fn find(name: &str) -> Result<&'static App, String> {
    APPS.iter()
        .find(|app| app.name == name)
        .ok_or_else(|| format!("unknown app: {name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apps_are_found_by_name_only() {
        assert_eq!(find("netflix").unwrap().samsung, "3201907018807");
        assert_eq!(find("youtube").unwrap().android, "https://www.youtube.com");
        assert!(find("https://example.com").is_err());
    }
}
