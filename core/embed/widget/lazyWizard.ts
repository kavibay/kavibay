import extension from "../../../extensions/widget-wizard/extension";
import views from "../../../extensions/widget-wizard/view";
import manifest from "../../../extensions/widget-wizard/manifest.json";

import calendarExtension from "../../../extensions/calendar/extension";
import fitbitExtension from "../../../extensions/fitbit/extension";
import githubExtension from "../../../extensions/github/extension";
import linearExtension from "../../../extensions/linear/extension";
import n8nExtension from "../../../extensions/n8n/extension";
import notionExtension from "../../../extensions/notion/extension";
import spotifyExtension from "../../../extensions/spotify/extension";
import tadoExtension from "../../../extensions/tado/extension";
import trelloExtension from "../../../extensions/trello/extension";
import weatherExtension from "../../../extensions/weather/extension";

import "./wizardDemoChrome.css";
import { makeWizardFilesReadOnly } from "./wizardReadOnlyFiles";

/**
 * The file editor accepts no edits on a page. Installed here rather than in a
 * component, because it is one listener for the document and the Wizard may be
 * mounted more than once.
 */
makeWizardFilesReadOnly();

/**
 * The Widget Wizard's three files, behind one dynamic import.
 *
 * It is the heaviest thing this package can mount by a wide margin —
 * `WidgetWizardWidget.vue` is 230 KB of source and `widgetWizardLogic.ts`
 * another 117 — and most pages do not show it. Imported eagerly it took the
 * bundle from 72 KB gzip to 116, on every page, including a hero that only
 * needs a clock.
 *
 * This module exists so the import has somewhere to point: everything the
 * catalog needs for one widget, in one chunk, fetched only when a page has a
 * `<kavibay-widget definition="widget-wizard">` in it.
 *
 * WHY THE PROVIDERS RIDE ALONG:
 *
 * The Wizard's Integrations menu is not fed by its capability — the host
 * answers `wizard.providers()` straight from its own registry
 * (`runtime.ts`), by describing every provider loaded into it. With none
 * loaded the menu was empty, so the demo showed a Wizard that could not name a
 * single account, which is the opposite of the thing it is there to sell.
 *
 * Listing the real extensions rather than a hand-written array is the whole
 * point: ids, display names, whether a credential is needed and which one all
 * come from the shipping definitions, so the menu cannot drift from the
 * product, and the brand icons follow the ids for free. `providerStatus` is
 * derived in the host too, and needs no fixture: a provider without a
 * credential reports connected, every other one reports disconnected — which
 * is exactly true of a web page holding no accounts.
 *
 * They are registered, not mounted. `catalog.ts` keeps its own list of what a
 * page may put on screen, and these are not on it: the widgets these
 * extensions contribute need the network, and `browserCapabilityTransport`
 * refuses that. Only the definitions land in the registry, so the Wizard can
 * describe them.
 */
export default {
  extension,
  views,
  manifest,
  providers: [
    calendarExtension,
    fitbitExtension,
    githubExtension,
    linearExtension,
    n8nExtension,
    notionExtension,
    spotifyExtension,
    tadoExtension,
    trelloExtension,
    weatherExtension,
  ],
};
