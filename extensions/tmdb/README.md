# TMDB provider

Provider-only extension: `kavibay.tmdb/tmdb`. No widget is included.

In Settings → Credentials, add a **TMDB** credential with the **API Read Access
Token** from [your TMDB API settings](https://www.themoviedb.org/settings/api).
Paste the token without the `Bearer` prefix. The host encrypts it and attaches
it to API requests; custom widgets never receive the secret.

The Widget Wizard can select this provider and call `searchMovies` with
`{ query: "Inception" }`. It returns the first page (up to 20 movies), with
`id`, `title`, `releaseDate`, `posterUrl`, `rating`, `voteCount` and `url`.
Titles default to German; pass `language: "en-US"` for English.
An empty search returns an empty list without a network request.

`rating` is TMDB's community average from 0 to 10, or `null` without votes.
`posterUrl` and `releaseDate` are `null` when missing. The host rewrites poster
URLs for its image proxy, so widgets can bind `posterUrl` directly to an image.
API errors go through the existing provider error handling.

Call `watchProviders` with `{ movieId: "27205", country: "DE" }` to retrieve
availability for a movie from `searchMovies`. The country defaults to `DE` and
is normalized to uppercase. The result contains `movieId`, `country`,
`watchUrl`, `offers` and `attribution`. Each offer has a provider `id`, `name`,
nullable `logoUrl` and a `type`: `subscription`, `free`, `ads`, `rent` or `buy`.
The same provider can offer multiple types; use `id` plus `type` as the row key.
Logos use the same image proxy as posters. Results are cached for one hour.

An empty offer list means TMDB has no availability data for the selected
country; it does not establish that the movie is unavailable. `watchUrl` is
the returned TMDB watch-page link, or `null` if missing. TMDB does not supply
direct links into individual streaming services through this endpoint.
Display the returned `attribution` text ("Streaming availability: JustWatch")
alongside availability data, as required by the endpoint's JustWatch terms.

Custom widgets declare the provider in their permissions:

```json
{ "id": "kavibay.tmdb/tmdb", "queries": ["searchMovies", "watchProviders"] }
```

When displaying this data, follow [TMDB's attribution requirements](https://developer.themoviedb.org/docs/faq):
use an approved TMDB logo and the required notice in the application's About
or Credits section. Non-commercial use is free with attribution; commercial
use requires a TMDB license. This provider does not add an attribution UI.

API references: [movie search](https://developer.themoviedb.org/reference/search-movie),
[watch providers](https://developer.themoviedb.org/reference/movie-watch-providers),
[authentication](https://developer.themoviedb.org/docs/authentication-application),
[poster URLs](https://developer.themoviedb.org/docs/image-basics).
