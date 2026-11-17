import { getDataStamp } from "@/lib/queries";
import { LiveRefresher } from "@/components/live/live-refresher";
import { StaleBanner } from "@/components/live/stale-banner";

/**
 * The live layer of the root layout: the stale banner and the one poller.
 * Reads the render's data stamp from the same cached, `radar-data`-tagged
 * layer as every page, so the version handed to the refresher describes the
 * data this render was built from. Cached, so it stays in the static shell.
 */
export async function LiveChrome() {
  const stamp = await getDataStamp();
  return (
    <>
      <StaleBanner renderedSession={stamp.session} />
      <LiveRefresher renderedVersion={stamp.dataVersion} />
    </>
  );
}
