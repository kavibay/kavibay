# Moodist extension — licenses & attribution

The widget is modelled on the open-source [Moodist](https://github.com/remvze/moodist)
project and ships small inline icons for the Kavibay widget UI.

## Moodist (project)

Moodist is licensed under the **MIT License**:

- Upstream: https://github.com/remvze/moodist
- License text: https://github.com/remvze/moodist/blob/main/LICENSE

## Sounds

Every sound is listed in `soundInventory.ts` with its source; `catalog.assert.ts`
refuses a sound without one, a recording that is not CC0, and any file under
`sounds/` the inventory does not name.

### Recordings — Freesound, CC0 1.0

Released into the public domain by their authors on Freesound
([CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)). Attribution is
not required; it is kept here so each file can be traced to its original.
`buildSounds.mts` cuts, loops, levels and encodes them from the originals.

| Sound | Original | Author |
|---|---|---|
| Creek | [Creek 06 (loop)](https://freesound.org/people/VKProduktion/sounds/231536/) | VKProduktion |
| Waves | [Waves at Baltic Sea shore.wav](https://freesound.org/people/pulswelle/sounds/339517/) | pulswelle |
| Forest | [sfx_amb_forest_spring_afternoon-01.wav](https://freesound.org/people/bajko/sounds/385280/) | bajko |
| Night Forest | [Forest at night, crickets, cicadas and insects in the Sian Ka'an Biosphere Reserve](https://freesound.org/people/felix.blume/sounds/328293/) | felix.blume |
| Campfire | [Hearthfire (Louder)](https://freesound.org/people/SilverIllusionist/sounds/836535/) | SilverIllusionist — a remix of [campfire.wav](https://freesound.org/people/Spandau/sounds/40699/) (Spandau) and [Campfire 02](https://freesound.org/people/HECKFRICKER/sounds/729396/) (HECKFRICKER), both CC0 |
| Light Rain | [Light Rain](https://freesound.org/people/soundrecorder7/sounds/167034/) | soundrecorder7 |
| Rain on Car Roof | [Hard Rain on Car Roof.wav](https://freesound.org/people/eRobb4/sounds/344460/) | eRobb4 |
| Thunderstorm | [Rain and thunder in Thailand](https://freesound.org/people/felix.blume/sounds/447510/) | felix.blume |

### Noise — generated at runtime

White, pink and brown noise are computed by `noise.ts` when they are played.
No audio file is shipped for them; the code is covered by this extension's MIT
licence.

### Not shipped

Moodist's own recordings are not redistributed. Upstream licenses them under
the Pixabay Content License or CC0 but does not say which file falls under
which, so none of them can be attributed with certainty.
