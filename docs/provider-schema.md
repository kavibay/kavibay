# Provider schema

**Generated — do not edit.** Written by `scripts/providerSchemaDoc.ts` from the
shipping providers under `extensions/*/provider.ts`; `providerSchemaDoc.assert.ts`
fails the build when this file and the code disagree.

What a query returns is the provider's own shape, not the vendor's JSON. That is
the point of the `result` column: a widget — including a generated one — reads
these fields and never learns how the upstream API nests things.

## Google Calendar

`kavibay.calendar/calendar` · `extensions/calendar/provider.ts`

Needs a connected account. The widget gate shows a connect prompt until then.

| Query | Reads | Arguments | Returns | Refresh |
|---|---|---|---|---|
| `calendars` | The calendars available in your Google account | none | `list of { id: string, name: string, color: string?, primary: boolean }` | 60 min |
| `events` | Events in one Google Calendar for the visible month | `calendarId: string` (from `calendars`), `rangeStart: string`, `rangeEnd: string` | `list of { id: string, calendarId: string, title: string, start: string, end: string, allDay: boolean, color: string?, meetingUrl: string? }` | 5 min |

Actions: `createEvent` (write).

## Fitbit

`kavibay.fitbit/fitbit` · `extensions/fitbit/provider.ts`

Needs a connected account. The widget gate shows a connect prompt until then.

| Query | Reads | Arguments | Returns | Refresh |
|---|---|---|---|---|
| `activityToday` | Today's steps, calories, distance and active minutes on Fitbit | none | `{ steps: number, caloriesOut: number, distance: number, floors: number, fairlyActiveMinutes: number, lightlyActiveMinutes: number, sedentaryMinutes: number, veryActiveMinutes: number, stepsGoal: number? }` | 15 min |
| `profile` | Your Fitbit profile name, member since date and average steps | none | `{ displayName: string, memberSince: string, avatarUrl: string, averageDailySteps: number }` | 60 min |
| `sleepToday` | Last night's sleep on Fitbit | none | `{ minutesAsleep: number, timeInBed: number, efficiency: number?, records: number }` | 30 min |

No actions — this provider is read-only.

## GitHub

`kavibay.github/github` · `extensions/github/provider.ts`

Needs a connected account. The widget gate shows a connect prompt until then.

| Query | Reads | Arguments | Returns | Refresh |
|---|---|---|---|---|
| `repoStatus` | Recent workflow runs and job progress for one repository | `owner: string`, `repo: string` | `{ owner: string, repo: string, spotlight: { id: number, name: string, status: string, conclusion: string?, branch: string, event: string, htmlUrl: string, createdAt: string, updatedAt: string, jobs: list of { id: number, name: string, status: string, conclusion: string?, steps: list of { name: string, status: string, conclusion: string?, number: number } }, jobsError: string? }?, recent: list of { id: number, name: string, status: string, conclusion: string?, branch: string, event: string, htmlUrl: string, createdAt: string, updatedAt: string }, fetchedAt: string }` | 30 s |
| `reviewRequests` | Pull requests waiting for your review | none | `list of { title: string, repository: string, url: string, updatedAt: string }` | 5 min |

No actions — this provider is read-only.

## Linear

`kavibay.linear/linear` · `extensions/linear/provider.ts`

Needs a connected account. The widget gate shows a connect prompt until then.

| Query | Reads | Arguments | Returns | Refresh |
|---|---|---|---|---|
| `assignedIssues` | Open issues assigned to you in Linear | none | `list of { id: string, identifier: string, title: string, url: string, updatedAt: string, state: string, stateType: string, team: string, teamKey: string }` | 1 min |
| `teamIssues` | Open issues in one Linear team | `teamId: string` (from `teams`) | `list of { id: string, identifier: string, title: string, url: string, updatedAt: string, state: string, stateType: string, team: string, teamKey: string }` | 1 min |
| `teams` | The teams in your Linear workspace | none | `list of { id: string, name: string, key: string }` | 5 min |

Actions: `createIssue` (write), `updateIssue` (write).

## n8n

`kavibay.n8n/n8n` · `extensions/n8n/provider.ts`

Needs a connected account. The widget gate shows a connect prompt until then.

| Query | Reads | Arguments | Returns | Refresh |
|---|---|---|---|---|
| `executionProgress` | Which step one n8n execution is on: currentNode (null when unknown or finished), lastNode (last finished), totalNodes and every node that has run with its status and timing. executionId comes from executions. n8n writes this during a run only when the workflow setting Save execution progress (or EXECUTIONS_DATA_SAVE_ON_PROGRESS) is on; otherwise nodes stays empty until the run ends, so show the execution status then, not an error. | `executionId: string` (from `executions`) | `{ id: string, status: string, lastNode: string?, currentNode: string?, waitTill: string?, totalNodes: number, nodes: list of { name: string, status: string, startedAt: string, durationMs: number } }` | 5 s |
| `executions` | Running n8n executions first, then the most recent finished ones. Without workflowId this is the newest across every workflow — one request for a status board instead of one per workflow; group by workflowId. status is running, success, error, canceled, waiting or crashed. | `workflowId?: string` (from `workflows`) | `list of { id: string, workflowId: string, status: string, mode: string, startedAt: string, stoppedAt: string? }` | 5 s |
| `workflows` | The workflows on your n8n instance | none | `list of { id: string, name: string, active: boolean, updatedAt: string }` | 5 min |

Actions: `triggerWebhook` (write).

## Notion

`kavibay.notion/notion` · `extensions/notion/provider.ts`

Needs a connected account. The widget gate shows a connect prompt until then.

| Query | Reads | Arguments | Returns | Refresh |
|---|---|---|---|---|
| `databasePages` | The pages in one Notion database; `properties` lists every column — find one by `name` | `databaseId: string` (from `databases`) | `list of { id: string, title: string, url: string, lastEdited: string, status: string?, properties: list of { name: string, type: string, value: string? } }` | 1 min |
| `databases` | Databases shared with your Notion integration | none | `list of { id: string, title: string, url: string, lastEdited: string }` | 5 min |
| `pages` | Pages shared with your Notion integration, most recently edited first | none | `list of { id: string, title: string, url: string, lastEdited: string, status: string?, properties: list of { name: string, type: string, value: string? } }` | 1 min |

Actions: `setProperty` (write).

## Spotify

`kavibay.spotify/spotify` · `extensions/spotify/provider.ts`

Needs a connected account. The widget gate shows a connect prompt until then.

| Query | Reads | Arguments | Returns | Refresh |
|---|---|---|---|---|
| `currentlyPlaying` | What is playing on your Spotify account right now | none | `{ isPlaying: boolean, progressMs: number, durationMs: number, title: string, artist: string, album: string, albumImageUrl: string?, trackUrl: string, trackId: string }?` | 20 s |
| `devices` | The Spotify Connect devices this account can play on right now: name, type, isActive, isRestricted. A device only appears while its Spotify app is open. Pass one id as deviceId to play or playTrack to start there instead of on the active device. | none | `list of { id: string, name: string, type: string, isActive: boolean, isRestricted: boolean, volumePercent: number }` | 10 s |
| `me` | Your Spotify profile name, plan and avatar | none | `{ id: string, displayName: string, product: string, imageUrl: string?, url: string }` | 60 min |
| `playlists` | The playlists on your Spotify account: name, owner, trackCount, imageUrl. To start one on the active device, call play with that playlist's id. | none | `list of { id: string, name: string, url: string, imageUrl: string?, trackCount: number, owner: string }` | 5 min |
| `playlistTracks` | The tracks on one Spotify playlist. Spotify 403s some playlists that still appear in playlists (Spotify-owned mixes, or an app in Development Mode reading a playlist it does not own); a list widget that also subscribes to this query will error the whole card. For a plain count use trackCount from playlists — it needs no extra request and no extra access. | `playlistId: string` (from `playlists`) | `list of { id: string, title: string, artist: string, album: string, durationMs: number, url: string, addedAt: string }` | 1 min |
| `recentlyPlayed` | Tracks you played recently on Spotify | none | `list of { id: string, title: string, artist: string, album: string, durationMs: number, url: string, playedAt: string }` | 1 min |
| `savedTracks` | Liked songs on your Spotify account | none | `list of { id: string, title: string, artist: string, album: string, durationMs: number, url: string, addedAt: string }` | 5 min |
| `topArtists` | Your top artists on Spotify over the last six months | none | `list of { id: string, name: string, url: string, imageUrl: string?, genres: string }` | 60 min |
| `topTracks` | Your top tracks on Spotify over the last six months | none | `list of { id: string, title: string, artist: string, album: string, durationMs: number, url: string }` | 60 min |

Actions: `play` (write), `pause` (write), `next` (write), `previous` (write), `playTrack` (write).

## tado°

`kavibay.tado/tado` · `extensions/tado/provider.ts`

Needs a connected account. The widget gate shows a connect prompt until then.

| Query | Reads | Arguments | Returns | Refresh |
|---|---|---|---|---|
| `zones` | The names of your heating zones | none | `list of { id: string, name: string }` | 360 min |
| `zoneStates` | Current temperature, humidity and target temperature in every room | none | `list of { id: string, temperature: number?, humidity: number?, target: number? }` | 16 min |

Actions: `setTemperature` (write).

## Weather (Open-Meteo)

`kavibay.weather/weather` · `extensions/weather/provider.ts`

Needs no credential.

| Query | Reads | Arguments | Returns | Refresh |
|---|---|---|---|---|
| `airQuality` | The current European air quality index (AQI) for a place | `location: string` (from `places`) | `{ place: string, aqi: number?, level: string }` | 10 min |
| `current` | The current outdoor temperature and conditions for a place | `location: string` (from `places`) | `{ place: string, temperature: number?, apparentTemperature: number?, humidity: number?, windSpeed: number?, condition: string }` | 10 min |
| `forecast` | Current conditions plus the next hours and days for a place, as the Weather widget shows them | `location: string` (from `places`) | `{ location: string, temperature_c: number, condition: string, icon: string, apparent_c: number, humidity_pct: number, wind_kmh: number, hourly: list of { time: string, temperature_c: number, icon: string, condition: string }, daily: list of { date: string, temperature_min_c: number, temperature_max_c: number, icon: string, condition: string } }` | 3 min |
| `places` | Places matching a name, so a widget can offer a list to pick from | `name: string` | `list of { id: string, name: string }` | 1440 min |

No actions — this provider is read-only.
