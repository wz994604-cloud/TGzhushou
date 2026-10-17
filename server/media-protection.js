// Media is shared and may be referenced by immutable send history, not just drafts.
export async function deleteUnusedMedia(db, id) {
  return db.transaction(async () => {
    for (const table of ['tasks','runs','broadcasts','chat_messages']) {
      if (await db.prepare(`SELECT 1 FROM ${table} WHERE media_id=? LIMIT 1`).get(id))
        throw new Error('素材正在被任务或消息记录引用，请保留素材');
    }
    const result = await db.prepare('DELETE FROM media WHERE id=?').run(id);
    return { deleted:Boolean(result.changes) };
  })();
}
