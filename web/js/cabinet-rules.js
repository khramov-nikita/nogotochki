import { requireClient } from "./require-client.js";

async function init() {
  const client = await requireClient();
  if (!client) {
    return;
  }
  const from = new URLSearchParams(location.search).get("from");
  if (from && /^\d+$/.test(from)) {
    document.getElementById("rules-back").href = `cabinet-appointment.html?id=${from}`;
  }
}

init();
