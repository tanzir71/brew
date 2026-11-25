// Only in Brew hides passive Reader lists. Explicit saved/search/direct-feed
// access remains available, and the Newsletters screen still manages the sender.
export const readerNewsletterVisibility =
  "(f.kind<>'newsletter' OR coalesce(json_extract(f.settings_json,'$.onlyInBrew'),0)<>1)";
