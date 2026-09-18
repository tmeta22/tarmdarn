// A starting set of common Cambodia place types, offered as datalist
// suggestions — NOT a locked enum. The category column in Supabase is
// plain text, so anyone is free to type a category that isn't listed
// here (e.g. "bridge", "pagoda festival ground") and it will still
// filter/group/sort correctly.
export const CATEGORIES = [
  { value: "School", label: "School" },
  { value: "Hospital / Clinic", label: "Hospital / Clinic" },
  { value: "Government office", label: "Government office" },
  { value: "Market", label: "Market" },
  { value: "Restaurant / Café", label: "Restaurant / Café" },
  { value: "Hotel / Guesthouse", label: "Hotel / Guesthouse" },
  { value: "Pagoda / Temple", label: "Pagoda / Temple" },
  { value: "Bank / ATM", label: "Bank / ATM" },
  { value: "Gas station", label: "Gas station" },
  { value: "Park / Public space", label: "Park / Public space" },
  { value: "Road / Bridge", label: "Road / Bridge" },
  { value: "Shop / Store", label: "Shop / Store" },
  { value: "Other", label: "Other" },
];

export function categoryLabel(value) {
  if (!value || !String(value).trim()) return "Uncategorized";
  return String(value).trim();
}
