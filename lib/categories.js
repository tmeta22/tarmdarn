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

// Google Places (New) primaryType/type keys → our category values.
// See https://developers.google.com/maps/documentation/places/web-service/place-types
const TYPE_TO_CATEGORY = [
  [/(primary_school|secondary_school|school|high_school|preschool|kindergarten|university|college|education)/i, "School"],
  [/(hospital|clinic|doctor|pharmacy|medical|health|dental|veterinary)/i, "Hospital / Clinic"],
  [/(government_office|city_hall|courthouse|embassy|local_government_office|police|fire_station|post_office|administrative_area_level)/i, "Government office"],
  [/(market|shopping_mall|supermarket|grocery|store|wholesaler|convenience_store)/i, "Market"],
  [/(restaurant|cafe|café|bakery|food|meal_takeaway|meal_delivery|bar|night_club|ice_cream)/i, "Restaurant / Café"],
  [/(hotel|lodging|guesthouse|guest_house|resort|hostel|motel|bed_and_breakfast)/i, "Hotel / Guesthouse"],
  [/(hindu_temple|mosque|church|place_of_worship|pagoda|temple|monastery|wat|buddhist)/i, "Pagoda / Temple"],
  [/(bank|atm|finance|credit_union)/i, "Bank / ATM"],
  [/(gas_station|fuel|petrol)/i, "Gas station"],
  [/(park|zoo|playground|stadium|sports_complex|amusement_park|natural_feature|tourist_attraction)/i, "Park / Public space"],
  [/(road|bridge|route|highway|street|intersection|traffic)/i, "Road / Bridge"],
];

// Keywords in the place name / address also contribute a guess — useful
// because Google's primaryType is often too generic (e.g. `point_of_interest`
// for a pagoda).
const KEYWORD_TO_CATEGORY = [
  // Khmer + English school keywords
  [/(\b(?:វិទ្យាល័យ|សាលា|សកលវិទ្យាល័យ|មត្តេយ្យ|គ្រឹះស្ថាន)\b|(?:preschool|kindergarten|primary|secondary|high school|university|college|institute|academy)\b)/i, "School"],
  // Khmer + English pagoda/temple keywords
  [/(\b(?:វត្ត|បូជាល័យ|ព្រះវិហារ|វិហារ|សាលាខ្មែរ|ចតុមុខ)\b|(?:pagoda|temple|wat|monastery|stupa|chedi)\b)/i, "Pagoda / Temple"],
  // Hospital/clinic
  [/(\b(?:មន្ទីរពេទ្យ|គ្លីនិក|ឱសថស្ថាន|ពេទ្យ|ថ្នាំង|ជំងឺ|ថ្នាំងពេទ្យ|ថ្នាំងជំងឺ)\b|(?:hospital|clinic|pharmacy|medical|health|dental|veterinary|doctor)\b)/i, "Hospital / Clinic"],
  // Market
  [/(\b(?:ផ្សារ|ទីផ្សារ|ផ្សារទំនើប|ហាងលក់|សេវាកម្មលក់|គ្រឿងបរិក្ខារ|គ្រឿងប្រើប្រាស់)\b|(?:market|mart|mall|plaza|supermarket|grocery|convenience|store|shop|wholesale)\b)/i, "Market"],
  // Restaurant/cafe
  [/(\b(?:ភោជនីយដ្ឋាន|កាហ្វេ|កាហ្វេហាង|ហាងកាហ្វេ|ក្លឹប|ភោគាល័យ|ម្ហូប|បាយ|កញ្ចប់ម្ហូប)\b|(?:restaurant|cafe|café|coffee|bakery|bistro|diner|food|tavern|pub|bar)\b)/i, "Restaurant / Café"],
  // Hotel/guesthouse
  [/(\b(?:សណ្ឋាគារ|សណ្ឋាគារភ្ញៀវទេសចរណ៍|ហូតែល|ភ្ញៀវទេសចរណ៍|ផ្ទះសំណាក់|ផ្ទះល្វែង|អគារស្នាក់នៅ)\b|(?:hotel|guesthouse|guest house|resort|hostel|motel|inn|lodge)\b)/i, "Hotel / Guesthouse"],
  // Bank/ATM
  [/(\b(?:ធនាគារ|អេធីអឹម|ATM|បណ្តាញហិរញ្ញវត្ថុ|ហិរញ្ញវត្ថុ|សេវាកម្មហិរញ្ញវត្ថុ)\b|(?:bank|atm|finance|credit union)\b)/i, "Bank / ATM"],
  // Gas station
  [/(\b(?:ប្រេង|ស្ថានីយ៍ប្រេង|ប្រេងឥន្ធនៈ|ប្រេងសាំង|ប្រេងម៉ាស៊ូត|ប្រេងស៊ុល|ប្រេង|ស្ថានីយ៍ប្រេង|ស្ថានីយ៍ប្រេង)\b|(?:gas station|fuel|petrol|caltex|pss|total|station)\b)/i, "Gas station"],
  // Government office
  [/(\b(?:អគាររដ្ឋ|ការិយាល័យរដ្ឋ|ក្រសួង|នាយកដ្ឋាន|រដ្ឋបាល|ថ្នាក់ដឹកនាំ|ក្រុង|ខេត្ត|ស្រុក|ឃុំ|សង្កាត់|ក្រុម|ក្រុមប្រឹក្សា|គណៈកម្មាធិការ|សាលាក្រុង|សាលារដ្ឋ)\b|(?:ministry|department|provincial|municipal|district|commune|village|hall|office|government|court|police|post)\b)/i, "Government office"],
  // Park / public space
  [/(\b(?:ឧទ្យាន|សួនកុមារ|សួនសត្វ|កីឡដ្ឋាន|កន្លែងកីឡា|ទេសភាព|ទេសចរណ៍|ព្រឹត្តិការណ៍|សាលព្រឹត្តិការណ៍|សណ្ឋានដី|បឹង|ភ្នំ|ទឹកជ្រោះ|ទឹកធ្លាក់|កោះ|ច្រក|វាលស្មៅ|វាលស្រែ|ព្រៃឈើ|ជ្រោយ|ជ្រោយខ្លួន|ជ្រោយខ្លួន|សួនច្បារ)\b|(?:park|garden|zoo|playground|stadium|sports|lake|river|mountain|waterfall|beach|island|forest|reserve|plaza|square|monument)\b)/i, "Park / Public space"],
  // Road / bridge
  [/(\b(?:ផ្លូវ|ស្ពាន|មហាវិថី|ថ្នល់|ស្ទឹងស្ពាន|ផ្លូវជាតិ|ផ្លូវកោះ|ផ្លូវស្ពាន|ផ្លូវស្ពាន|ច្រករបៀង|រថភ្លើង|ការិយាល័យដឹកជញ្ជូន|ចំណតឡាន|ចំណតឡានដឹក|ចំណតឡានចុង|កន្លែងចំណត|កង់យន្តហោះ|កន្លែងដឹកជញ្ជូន)\b|(?:road|bridge|highway|street|avenue|route|intersection|traffic|bus|train|station|terminal|airport|port|ferry|harbor)\b)/i, "Road / Bridge"],
  // Shop / Store (catch-all commercial)
  [/(\b(?:ហាង|ផ្សារធំ|ហាងលក់|ហាងលក់ដៃទាំងសង|ហាងលក់ទំនិញ|ហាងលក់ម៉ាស៊ីន|ហាងលក់គ្រឿងប្រើប្រាស់|ហាងលក់ធាតុ|ហាងលក់អាវុធ|ហាងលក់ផលិតផល|ហាងលក់ផលិតផលកសិកម្ម|ហាងលក់បន្ទន់ជីវិត|ហាងលក់ផលិតផលធំ)\b|(?:shop|store|outlet|boutique|retail|dealer|supplier|hardware|electronics|furniture|clothing|books|pharmacy is handled above|hardware is handled here)\b)/i, "Shop / Store"],
];

/**
 * Guess a category value from a Google Places result.
 *
 * @param {{ primaryType?: string|null, types?: string[]|null, name?: string|null, address?: string|null }} place
 * @returns {string|null} A CATEGORIES-compatible value, or null if nothing matched.
 */
export function guessCategoryFromPlace(place) {
  if (!place) return null;
  const haystack = [
    place.primaryType || "",
    ...(Array.isArray(place.types) ? place.types : []),
    place.name || "",
    place.address || "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!haystack.trim()) return null;

  // Match Google place type keys first (most reliable).
  for (const [re, cat] of TYPE_TO_CATEGORY) {
    if (re.test(haystack)) return cat;
  }
  // Fall back to name/address keyword hints (Khmer + English).
  for (const [re, cat] of KEYWORD_TO_CATEGORY) {
    if (re.test(haystack)) return cat;
  }
  return null;
}
