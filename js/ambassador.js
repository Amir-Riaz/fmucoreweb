
const AMBASSADOR_XLSX_PATH = "rfiles/COREAmb.xlsx"; // adjust if you host it elsewhere

let cachedCodes = null; // Map<normalizedCode, { fullName, institute }>

async function loadAmbassadorCodes() {
  if (cachedCodes) return cachedCodes;

  if (typeof XLSX === "undefined") {
    throw new Error("SheetJS (XLSX) is not loaded — add the CDN script tag to this page.");
  }

  const res = await fetch(AMBASSADOR_XLSX_PATH, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ambassador list (${res.status})`);
  const buf = await res.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const map = new Map();
  rows.forEach((row) => {
    const code = String(row["Ambassador Code"] || "").trim().toUpperCase();
    if (!code) return;
    map.set(code, {
      fullName: String(row["Full Name"] || "").trim(),
      institute: String(row["Institute "] ?? row["Institute"] ?? "").trim(),
    });
  });

  cachedCodes = map;
  return cachedCodes;
}

/**
 * @param {string} code
 * @returns {Promise<{ valid: boolean, fullName?: string, institute?: string }>}
 */
export async function verifyAmbassadorCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) return { valid: false };

  const codes = await loadAmbassadorCodes();
  const match = codes.get(normalized);
  if (!match) return { valid: false };
  return { valid: true, fullName: match.fullName, institute: match.institute };
}