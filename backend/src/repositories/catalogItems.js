export function upsert(db, item) {
  return db.query(
    `INSERT INTO catalog_items (external_id, title, image_url, description, attributes, source_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (external_id) DO UPDATE
        SET title = EXCLUDED.title,
            image_url = EXCLUDED.image_url,
            description = EXCLUDED.description,
            attributes = EXCLUDED.attributes,
            source_url = EXCLUDED.source_url,
            cached_at = now()`,
    [
      item.externalId,
      item.title,
      item.imageUrl,
      item.description,
      JSON.stringify(item.attributes),
      item.sourceUrl,
    ],
  );
}

/** Escapa % _ \ para que o termo digitado seja tratado como texto literal no ILIKE. */
const escapeLike = (term) => term.replace(/[\\%_]/g, '\\$&');

export async function search(db, term, limit) {
  const { rows } = await db.query(
    `SELECT external_id, title, image_url, description, attributes, source_url
       FROM catalog_items
      WHERE title ILIKE $1 OR attributes::text ILIKE $1
      ORDER BY cached_at DESC
      LIMIT $2`,
    [`%${escapeLike(term)}%`, limit],
  );
  return rows.map((row) => ({
    externalId: row.external_id,
    title: row.title,
    imageUrl: row.image_url,
    description: row.description,
    attributes: row.attributes,
    sourceUrl: row.source_url,
  }));
}
