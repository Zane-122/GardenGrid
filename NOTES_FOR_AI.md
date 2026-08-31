# Notes for AI — Plant.id API v3

Source of truth: [plant.id API v3 Postman docs](https://documenter.getpostman.com/view/24599534/2s93z5A4v2#95256bd1-b9c4-4370-a086-3c97d5079d9d). Extra context: [Kindwise handbook](https://www.kindwise.com/handbook), [plant.health product page](https://www.kindwise.com/plant-health), [Plant.id FAQ](https://web.plant.id/faq/). Official OpenAPI is advertised from the Postman page; LLM-oriented trial lives at [agents.kindwise.com](https://agents.kindwise.com/).

Garden Grid is an Expo 57 garden app. Onboarding already collects name / username / theme / “has a garden.” Plant inventory is the next product surface. These notes cover the two endpoints we should implement first (`POST /identification`, `GET /kb/plants/name_search`) and how health assessment rides along.

**Do not put the Plant.id key in `EXPO_PUBLIC_*`.** Call Plant.id from a backend (Supabase Edge Function, or similar). The client already has an unused Supabase client in `utils/supabase.ts`.

Kindwise is not liable for injury or damage from bad IDs, edibility, toxicity, or treatment advice. Never present those fields as medical/veterinary/agronomic fact. Cite licenses when showing Wikipedia descriptions or `similar_images`.

---

## Auth and base URL

- Base: `https://plant.id/api/v3` (examples also use `https://api.plant.id/v3`)
- Header: `Api-Key: <key>` (preferred). Alternative: HTTP basic, username `client`, password = API key.
- Key comes from the [Kindwise admin panel](https://admin.kindwise.com/signup). Plant.id keys are product-specific.
- Status codes: `200` OK, `201` created, `400` bad input, `401` bad key, `404` missing object, `429` out of credits, `500` server error.

---

## Identification — `POST /identification`

Creates a plant ID from photos. This is the camera / “what is this plant?” path.

Results are stored **6 months** and can be re-fetched with extra `details` or another `language`.

### Request

Two encodings:

1. `application/json` — `images` is a list of Base64 strings or public URLs.
2. `multipart/form-data` — attributes as text fields; images as files (field names do not matter).

**Shared body fields**

| Field | Type | Notes |
|---|---|---|
| `images` | string[] | Required for JSON. One or more photos. Multiple angles help. |
| `latitude` / `longitude` | float | Optional. Improves accuracy. Use if the user allows location. |
| `similar_images` | bool | If true, each suggestion gets lookalike reference photos (license data included — cite them). |
| `custom_id` | int | Optional client id; can later retrieve by this instead of `access_token`. |
| `datetime` | ISO string | Optional. Helps seasonal IDs. Precision can be day (`2023-06-22`) or minute. |

**Classification fields**

| Field | Values | Notes |
|---|---|---|
| `classification_level` | `species` (default), `genus`, `all` | `all` adds cultivars / subspecies / varieties. Use `all` if inventory cares about named cultivars. |
| `classification_raw` | bool | If true, skip post-processing; response shape changes (genus / species / infraspecies kept separate). Prefer default unless debugging. |
| `suggestion_filter` | `{ "classification": "FILTER" }` | Restricts taxa. Filters combine with `AND` / `OR` / parentheses. Examples: `"vegetable"`, `"houseplant OR continent__europe"`, `"(continent__northern_america OR continent__europe) AND tree"`. |

**Health fields (same request — do not treat health as a later add-on)**

| Field | Values | Notes |
|---|---|---|
| `health` | omitted, `only`, `auto`, `all` | See [Health](#health-keep-this-in-mind). |
| `disease_level` | `all` (default), `general` | `general` = broad classes only (e.g. “feeding damage by insects”). |

`details` and `language` are **query params**, not body fields. They can be sent on create or later on retrieve:

```
POST /identification?details=common_names,url,watering,toxicity&language=en
```

`details` can also be requested on `GET /identification/{access_token}`.

### Response (classification)

- `access_token` — stable handle for retrieve / delete / feedback / chatbot. Persist this on any saved ID.
- `result.is_plant.binary` — `false` means the image probably is not a plant. Always gate UI on this.
- `result.is_plant.probability` — 0–1.
- `result.classification.suggestions[]`:
  - `id` — **stable**. Use this as our foreign key, not `name`.
  - `name` — current scientific name. **Can change** as taxonomy updates.
  - `probability` — 0–1 confidence.
  - `similar_images` — only if requested.
  - `details` — only the details you asked for; missing ones are `null`.

Three models exist (genus, species, infraspecific). Default post-processing merges them so the user does not see duplicates. Kindwise claims ~90% species accuracy and 35,000+ taxa.

### Related identification endpoints

| Method | Path | Use |
|---|---|---|
| `GET` | `/identification/{access_token}` | Re-fetch. Add/change `details` and `language` here to avoid re-running the model. |
| `DELETE` | `/identification/{access_token}` | Remove stored result. |
| `POST` | `/identification/{access_token}/feedback` | `{ "rating": 0-5, "comment": "..." }`. Returned on later retrieve. Send when the user confirms or rejects a suggestion. |
| `GET` | `/usage_info` | Credit balance. Surface this internally before shipping camera ID. |

There is also a dedicated `POST /health_assessment` in the same collection. Prefer the `health` field on `/identification` so one photo pass can return species + health.

---

## Name search — `GET /kb/plants/name_search`

This is the typeahead / “add plant by name” path. **Free.** Marked **alpha/beta — the contract can change.**

```
GET /kb/plants/name_search?q=aloe%20vera&limit=10&language=en&thumbnails=true
```

| Query | Notes |
|---|---|
| `q` | Required search string. |
| `limit` | Optional int. Default 10, max 20. |
| `language` | Optional. Default `en`. Up to 3 ISO codes, comma-separated (`en,de,sv`). Affects common-name matching. |
| `thumbnails` | Optional bool. If true, each hit gets a 64×64 Base64 thumbnail. |

Searchable by scientific name, synonyms, and common names in the requested language(s).

Matching is **prefix-from-start-of-word**. `"Aloe vera"` matches `Aloe`, `Alo`, `Vera`, `ver`, `Aloe vera`. It will not match mid-word fragments.

### Response

```json
{
  "entities": [
    {
      "matched_in": "Aloe vera",
      "matched_in_type": "entity_name",
      "access_token": "ADQuTDRVfU1caQRidkdcbFlsZVVBdV1lBDVnUGJRaFk-",
      "match_position": 0,
      "match_length": 9,
      "entity_name": "Aloe vera"
    }
  ],
  "entities_trimmed": false,
  "limit": 10
}
```

- `matched_in_type` is typically `entity_name` or `synonym`. A synonym hit still points at the accepted taxon via `entity_name` + `access_token`.
- `entities_trimmed` — true if more hits existed than `limit`.
- Debounce in the app. This endpoint is meant for keystroke suggestions.

### Follow-up: plant detail (not free)

```
GET /kb/plants/{access_token}?details=common_names,url,description,taxonomy,rank,gbif_id,inaturalist_id,image,synonyms,edible_parts,watering,propagation_methods&language=en
```

- `access_token` comes from name_search, **not** from identification (different token).
- `details` is required.
- Costs **0.5 credits** per call.
- Also alpha/beta.
- Response includes `entity_id`, `name`, plus requested fields. Descriptions and images carry `citation` / `license_name` / `license_url`.

Typical inventory flow: name_search as the user types → on pick, one detail call → persist `entity_id` + care fields locally / in Supabase.

---

## Health (keep this in mind)

Health is a second model (plant.health) that can run on the same identification request. ~548 conditions: abiotic disorders, pests, fungi, bacteria, viruses, chromista, plus non-harmful classes (lichen, moss, flower buds, harmless insects).

### How to request it

On `POST /identification`, set `health`:

| Value | What comes back | Credits |
|---|---|---|
| omitted | Species only | 1 |
| `only` | Health only (no species classification) | 1 (health) |
| `all` | Species + health always | 2 |
| `auto` | Species always; health only if a condition is detected | 1 if healthy, 2 if health is returned |

`auto` is the default we should prefer for camera ID: cheap when the plant looks fine, full diagnosis when it does not.

There is a separate `POST /health_assessment` if we ever want disease-only (e.g. user already knows the species and is photographing a sick leaf). Same health result shape.

### Health result shape

Present only when health ran:

- `result.is_healthy.binary` — `true` if the photos likely show a healthy plant.
- `result.is_healthy.probability` — 0–1 that the plant is healthy.
- `result.disease.suggestions[]`:
  - `id` — stable class id. Persist this.
  - `name` — may be vernacular (`water deficiency`) or scientific (`Agrobacterium tumefaciens`). Can change.
  - `probability` — 0–1. **Show several suggestions**, not just #1. Overwatering and nutrient deficiency often co-occur.
  - `similar_images` — if requested.
  - `details` — requested disease details.
- `result.disease.question` — optional follow-up to split close suggestions. `null` when not needed. Has `text` plus `yes` / `no` options that point at `suggestion_index` / `entity_id` / `name` in the disease list. Use this in the UI instead of inventing our own triage questions.

v3 **prunes general classes by default** (`prune_diseases`). Set `disease_level=general` only if we want those broad buckets.

### Disease details (query `details`)

| Detail | Notes |
|---|---|
| `local_name` | Localized label (useful for abiotic classes). |
| `description` | Short text; Wikipedia or expert-reviewed LLM. |
| `url` | Wikipedia / iNaturalist / Kindwise wiki. |
| `treatment` | `{ biological, chemical, prevention }`. Expert-compiled, not raw LLM. Bio/chemical may be missing; **prevention is always present**. |
| `is_harmful` | `false` for non-harmful classes (moss, buds, etc.). Filter these out of “your plant is sick” copy. |
| `classification` | Parent class; empty for non-taxonomic / general classes. |
| `common_names` | Other names for the class. |

Photo guidance for users: photograph the **affected part**, close enough to see pests or lesions. Vague whole-plant shots miss small insects.

### Recommended Garden Grid policy

1. Camera identify: `health=auto` + `similar_images=true` + species details we actually display.
2. If the user taps “this plant looks sick” after a species-only result: either retrieve is not enough — run `POST /health_assessment` (or a new identification with `health=only` / `all`) on a close-up of the damage.
3. Never auto-apply chemical treatment text as a to-do. Show prevention first; label chemical/biological as reference.
4. Treat `is_healthy.binary === true` as “no obvious problem in this photo,” not a guarantee.

---

## Details we will likely request

Ask only for what the UI will show. Each unused field is payload and sometimes licensed text we must attribute.

**Taxa (identification retrieve or name_search detail)** — good for inventory cards:

- `common_names`, `url`, `taxonomy`, `rank`, `synonyms`
- `image` (or `images`) — licensed
- `watering` — `{ min, max }` on a 1–3 scale: 1 dry, 2 medium, 3 wet. Map to labels (“dry to medium”), not raw numbers. `null` if unknown.
- `propagation_methods` — `cuttings` | `division` | `grafting` | `seeds` | `spores` | `suckers`
- `edible_parts` — from Plants for a Future; can be wrong. Possible values include `leaves`, `fruit`, `seeds`, `flowers`, `tubers`, …
- `best_watering`, `best_light_condition`, `best_soil_type`, `toxicity` — English-only short paragraphs
- `description` (Wikipedia, licensed) vs `description_gpt` vs `description_all` (combined)

**Stable IDs to store:** Kindwise taxon `id` / `entity_id`, plus `gbif_id` and `inaturalist_id` when present. Do **not** key our DB on scientific `name`.

**Languages:** `en` default. Also `de`, `cs`, `es`, `fr`, `it`, `nl`, `pl`, `sv`, `zh`, `zh-hant`, `da`, `tr`, `hi`, `ar`, `pt-BR`, `ko`. Up to 3 at once on search/detail.

---

## How this maps to Garden Grid

| User action | Endpoint | Credits |
|---|---|---|
| Type a plant name in inventory | `GET /kb/plants/name_search` | free |
| Confirm a typed plant and load care data | `GET /kb/plants/{token}` | 0.5 |
| Photo identify (and maybe health) | `POST /identification` (`health=auto`) | 1 or 2 |
| User says the plant is sick | `POST /health_assessment` or identify with `health=all`/`only` | 1 |
| Re-show an old ID with more fields | `GET /identification/{token}?details=...` | no extra model run |

Onboarding `hasGarden` can later choose copy (“add what you already grow” vs “identify your first plant”) but does not change the API.

---

## Implemented (Garden Grid)

Two tables live in Supabase. `plants` is ownership (`id`, `user_id` → `profiles.id`, `plant_id`). `plant_basic_info` is the refreshable Plant.id cache keyed by `plant_id`.

Edge functions (JWT required, `verify_jwt = true`):

- `search-plant-name` — `{ q }` searches; `{ access_token }` fetches details, upserts `plant_basic_info`, inserts `plants` for the caller.
- `identify-plant-photo` — `{ images }` identifies, upserts cache, inserts `plants` for the top suggestion.

Client helpers in `utils/plants.ts` send `Authorization: Bearer <session.access_token>`. The Plant.id key must be the Edge Function secret `PLANTID_API_KEY`, never `EXPO_PUBLIC_*`.

---

## Implementation constraints (Expo)

- Keep the key server-side. A leaked `EXPO_PUBLIC_` Plant.id key is a credit drain.
- Prefer sending image URLs the server can fetch, or upload to Supabase Storage and pass that URL. Large Base64 bodies on device → edge function work, but stay within function payload limits.
- `name_search` is beta: wrap the client so field names can change without rewriting screens.
- `429` means credits, not rate-limit in the usual sense. Handle it as “identification unavailable.”
- Python SDK exists (`kindwise-api-client`) if we ever script imports; the app itself should use `fetch`.
