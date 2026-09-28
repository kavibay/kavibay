# Google Calendar

View a Google Calendar month, browse daily events, and quickly add events.

## Setup

Kavibay ships no Google client of its own, so the calendar signs in through one
you create in the [Google Cloud Console](https://console.cloud.google.com/).

1. Create a project, or pick an existing one.
2. Enable the **Google Calendar API** in the API library.
3. Set up the OAuth consent screen with the user type **External**, and add your
   own Google account as a **test user**.
4. Create an **OAuth client ID** of the type **Desktop app**. A Desktop client
   accepts any loopback redirect, so there is no redirect URI to enter.
5. In Kavibay, open **Settings → Integrations → Credentials → Google Calendar
   OAuth2**, paste the Client ID and the Client Secret, and sign in.

## Why it asks you to sign in again after a week

While the consent screen's publishing status is **Testing**, Google lets a
refresh token live for 7 days. After that the connection stops working and you
have to sign in again. Two ways around it:

- Set the publishing status to **In production**. You do not need Google's
  verification to use your own client. Google shows an "unverified app" warning
  at sign-in, which you can click through.
- With a Google Workspace account, choose the user type **Internal** instead of
  External. Internal clients have no 7-day limit.
