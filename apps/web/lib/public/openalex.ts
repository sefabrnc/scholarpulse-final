const OPENALEX_BASE_URL = "https://api.openalex.org";
const OPENALEX_USER_AGENT = "ScholarPulse Public Web/1.0";

export type OpenAlexWork = {
  id?: string;
  doi?: string | null;
  title?: string;
  publication_year?: number | null;
  cited_by_count?: number | null;
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string | null } | null } | null;
  authorships?: Array<{ author?: { display_name?: string | null } | null }> | null;
};

export async function fetchOpenAlexJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${OPENALEX_BASE_URL}${path}`, {
      headers: { "User-Agent": OPENALEX_USER_AGENT },
      next: { revalidate: 600 }
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export function normalizeDoi(value: string): string {
  return value.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim().toLowerCase();
}

export function mapWork(work: OpenAlexWork) {
  const doi = work.doi ? normalizeDoi(work.doi) : null;
  const authors = (work.authorships ?? [])
    .map((entry) => entry.author?.display_name ?? "")
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 8);

  return {
    id: work.id ?? "",
    doi,
    title: work.title ?? "Untitled paper",
    year: work.publication_year ?? null,
    citedByCount: work.cited_by_count ?? 0,
    url: work.primary_location?.landing_page_url || (doi ? `https://doi.org/${doi}` : ""),
    journal: work.primary_location?.source?.display_name ?? null,
    authors
  };
}
