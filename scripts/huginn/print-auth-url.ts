import "dotenv/config";
import { authUrl } from "../../src/lib/google-oauth";

// S14b debug — print the generated OAuth URL's redirect_uri + client id SUFFIX
// (never the full client id or any secret).

const url = new URL(authUrl("debug:MAIN", "MAIN"));
const redirect = url.searchParams.get("redirect_uri");
const client = url.searchParams.get("client_id") ?? "";
console.log("redirect_uri:", redirect);
console.log("client_id suffix:", "..." + client.slice(-24));
