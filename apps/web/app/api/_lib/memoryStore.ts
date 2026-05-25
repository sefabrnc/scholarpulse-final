type Annotation = {
  id: string;
  userId: string;
  doi: string;
  page: number;
  norm_x: number;
  norm_y: number;
  norm_w: number;
  norm_h: number;
  color?: string;
  note?: string;
};

type Collection = {
  id: string;
  userId: string;
  name: string;
  count: number;
};

type Channel = {
  id: string;
  name: string;
  scope: "internal" | "public";
  description: string;
};

const interestsByUser = new Map<string, string[]>();
const annotationsByUser = new Map<string, Annotation[]>();
const collectionsByUser = new Map<string, Collection[]>();
const channelsSeed: Channel[] = [
  { id: "general", name: "General", scope: "internal", description: "Internal workspace updates" },
  { id: "open-review", name: "Open Review", scope: "public", description: "Public paper discussions" }
];

export function getInterests(userId: string): string[] {
  if (!interestsByUser.has(userId)) {
    interestsByUser.set(userId, ["transformers", "retrieval"]);
  }
  return interestsByUser.get(userId) ?? [];
}

export function setInterests(userId: string, topics: string[]) {
  interestsByUser.set(userId, topics);
}

export function getAnnotations(userId: string): Annotation[] {
  return annotationsByUser.get(userId) ?? [];
}

export function addAnnotation(annotation: Annotation) {
  const existing = annotationsByUser.get(annotation.userId) ?? [];
  annotationsByUser.set(annotation.userId, [annotation, ...existing]);
}

export function deleteAnnotation(userId: string, annotationId: string): boolean {
  const existing = annotationsByUser.get(userId) ?? [];
  const next = existing.filter((item) => item.id !== annotationId);
  if (next.length === existing.length) {
    return false;
  }
  annotationsByUser.set(userId, next);
  return true;
}

export function addCollection(userId: string, name: string): Collection {
  const existing = getCollections(userId);
  const created: Collection = {
    id: `col-${Date.now()}`,
    userId,
    name,
    count: 0
  };
  collectionsByUser.set(userId, [created, ...existing]);
  return created;
}

export function getCollections(userId: string): Collection[] {
  if (!collectionsByUser.has(userId)) {
    collectionsByUser.set(userId, [
      { id: "core", userId, name: "Core reading", count: 4 },
      { id: "review", userId, name: "Review queue", count: 2 }
    ]);
  }
  return collectionsByUser.get(userId) ?? [];
}

export function getChannels(): Channel[] {
  return channelsSeed;
}
