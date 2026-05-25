"use client";

export type SearchFilterValues = {
  yearFrom: string;
  yearTo: string;
  minCitations: string;
  journal: string;
  author: string;
  topic: string;
  sort: "relevance" | "citations" | "year";
};

type SearchFiltersPanelProps = {
  values: SearchFilterValues;
  onChange: (next: SearchFilterValues) => void;
  disabled?: boolean;
};

const DEFAULT_SORT: SearchFilterValues["sort"] = "relevance";

export function SearchFiltersPanel(props: SearchFiltersPanelProps) {
  const setField = (key: keyof SearchFilterValues, value: string) => {
    props.onChange({ ...props.values, [key]: value });
  };

  return (
    <fieldset className="search-filters" disabled={props.disabled}>
      <legend>Advanced filters</legend>
      <div className="search-filters-grid">
        <label className="search-filter-field">
          <span>Year from</span>
          <input
            type="number"
            min={1500}
            max={2500}
            value={props.values.yearFrom}
            onChange={(event) => setField("yearFrom", event.target.value)}
            placeholder="e.g. 2018"
          />
        </label>
        <label className="search-filter-field">
          <span>Year to</span>
          <input
            type="number"
            min={1500}
            max={2500}
            value={props.values.yearTo}
            onChange={(event) => setField("yearTo", event.target.value)}
            placeholder="e.g. 2024"
          />
        </label>
        <label className="search-filter-field">
          <span>Min citations</span>
          <input
            type="number"
            min={0}
            value={props.values.minCitations}
            onChange={(event) => setField("minCitations", event.target.value)}
            placeholder="e.g. 10"
          />
        </label>
        <label className="search-filter-field">
          <span>Journal</span>
          <input
            value={props.values.journal}
            onChange={(event) => setField("journal", event.target.value)}
            placeholder="e.g. NeurIPS"
          />
        </label>
        <label className="search-filter-field">
          <span>Author</span>
          <input
            value={props.values.author}
            onChange={(event) => setField("author", event.target.value)}
            placeholder="e.g. Vaswani"
          />
        </label>
        <label className="search-filter-field">
          <span>Topic</span>
          <input
            value={props.values.topic}
            onChange={(event) => setField("topic", event.target.value)}
            placeholder="e.g. transformers"
          />
        </label>
        <label className="search-filter-field">
          <span>Sort</span>
          <select
            value={props.values.sort ?? DEFAULT_SORT}
            onChange={(event) =>
              setField("sort", event.target.value as SearchFilterValues["sort"])
            }
          >
            <option value="relevance">Relevance</option>
            <option value="citations">Citations</option>
            <option value="year">Year</option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}

export function buildSearchQueryParams(query: string, filters: SearchFilterValues): URLSearchParams {
  const params = new URLSearchParams({ q: query.trim() });
  if (filters.yearFrom.trim()) {
    params.set("year_from", filters.yearFrom.trim());
  }
  if (filters.yearTo.trim()) {
    params.set("year_to", filters.yearTo.trim());
  }
  if (filters.minCitations.trim()) {
    params.set("min_citations", filters.minCitations.trim());
  }
  if (filters.journal.trim()) {
    params.set("journal", filters.journal.trim());
  }
  if (filters.author.trim()) {
    params.set("author", filters.author.trim());
  }
  if (filters.topic.trim()) {
    params.set("topic", filters.topic.trim());
  }
  if (filters.sort && filters.sort !== "relevance") {
    params.set("sort", filters.sort);
  }
  return params;
}
