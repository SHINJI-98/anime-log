package com.animelog.note;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class AnimeNoteRepository {
    private static final int SUMMARY_EPISODE_NUMBER = 0;

    private final JdbcTemplate jdbcTemplate;

    public AnimeNoteRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public AnimeNotesResponse findByAnimeSourceId(long animeSourceId) {
        AnimeNotesResponse response = new AnimeNotesResponse();
        response.setSummary(findByAnimeSourceIdAndEpisode(animeSourceId, SUMMARY_EPISODE_NUMBER));
        response.setEpisodeNotes(jdbcTemplate.query(
                "SELECT * FROM anime_notes WHERE anime_source_id = ? AND episode_number > 0 ORDER BY episode_number",
                rowMapper(),
                animeSourceId));
        return response;
    }

    public AnimeNote upsert(long animeSourceId, int episodeNumber, String content) {
        String now = Instant.now().toString();
        String nextContent = content == null ? "" : content;
        int updated = jdbcTemplate.update(
                "UPDATE anime_notes SET content = ?, updated_at = ? WHERE anime_source_id = ? AND episode_number = ?",
                nextContent,
                now,
                animeSourceId,
                episodeNumber);
        if (updated == 0) {
            jdbcTemplate.update(
                    "INSERT INTO anime_notes "
                            + "(anime_source_id, episode_number, content, created_at, updated_at) "
                            + "VALUES (?, ?, ?, ?, ?)",
                    animeSourceId,
                    episodeNumber,
                    nextContent,
                    now,
                    now);
        }
        return findByAnimeSourceIdAndEpisode(animeSourceId, episodeNumber);
    }

    public void deleteEpisode(long animeSourceId, int episodeNumber) {
        jdbcTemplate.update(
                "DELETE FROM anime_notes WHERE anime_source_id = ? AND episode_number = ? AND episode_number > 0",
                animeSourceId,
                episodeNumber);
    }

    private AnimeNote findByAnimeSourceIdAndEpisode(long animeSourceId, int episodeNumber) {
        List<AnimeNote> results = jdbcTemplate.query(
                "SELECT * FROM anime_notes WHERE anime_source_id = ? AND episode_number = ?",
                rowMapper(),
                animeSourceId,
                episodeNumber);
        return results.isEmpty() ? null : results.get(0);
    }

    private RowMapper<AnimeNote> rowMapper() {
        return new RowMapper<AnimeNote>() {
            @Override
            public AnimeNote mapRow(ResultSet rs, int rowNum) throws SQLException {
                AnimeNote note = new AnimeNote();
                note.setId(rs.getLong("id"));
                note.setAnimeSourceId(rs.getLong("anime_source_id"));
                note.setEpisodeNumber(rs.getInt("episode_number"));
                note.setContent(rs.getString("content"));
                note.setCreatedAt(rs.getString("created_at"));
                note.setUpdatedAt(rs.getString("updated_at"));
                return note;
            }
        };
    }
}
