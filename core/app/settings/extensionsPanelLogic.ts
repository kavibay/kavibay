import type { RegisteredExtension } from "@sdk/types";

export const ALL_CATEGORIES = "all";

/** Sorted category ids declared by the currently available extensions. */
export function extensionCategories(extensions: RegisteredExtension[]): string[] {
  return [...new Set(extensions.flatMap((extension) => extension.categories))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** Match the settings catalog by search text and one optional manifest category. */
export function filterExtensions(
  extensions: RegisteredExtension[],
  query: string,
  category: string,
): RegisteredExtension[] {
  const normalizedQuery = query.trim().toLowerCase();

  return extensions
    .filter((extension) =>
      category === ALL_CATEGORIES || extension.categories.includes(category),
    )
    .filter((extension) => {
      if (!normalizedQuery) return true;
      return [
        extension.id,
        extension.title,
        extension.description,
        extension.author,
        extension.version,
        ...extension.categories,
        ...extension.keywords,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}
