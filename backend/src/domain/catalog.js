const strip = (html) =>
  html
    ? String(html)
        .replace(/<[^>]*>/g, '')
        .trim()
    : null;

/** Converte um item da API do Cleveland Museum of Art no formato interno. */
export function normalizeItem(item) {
  const attributes = {
    Artista: item.creators?.[0]?.description,
    Data: item.creation_date,
    Tipo: item.type,
    Técnica: item.technique,
    Departamento: item.department,
    Cultura: item.culture?.join(', '),
    Medidas: item.measurements,
  };
  for (const k of Object.keys(attributes)) if (!attributes[k]) delete attributes[k];
  return {
    externalId: String(item.id),
    title: item.title,
    imageUrl: item.images?.web?.url ?? null,
    description: strip(item.description) ?? strip(item.tombstone),
    attributes,
    sourceUrl: item.url ?? null,
  };
}
