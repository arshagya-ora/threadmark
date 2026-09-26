export const APP_NAME = "Threadmark";
export const APP_TAGLINE = "Follow the evidence.";
export const APP_AUTHOR = "ARshagya Shrivastava";
export const APP_DESCRIPTION =
  "A document research workspace for source-grounded answers and connected knowledge.";

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL?.trim() || "http://localhost:8000"
).replace(/\/+$/, "");
