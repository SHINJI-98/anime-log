package com.animelog.watch;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import com.animelog.anime.AnimeSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class WatchRecordRepository {
    private final JdbcTemplate jdbcTemplate;

    public WatchRecordRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<WatchRecord> findAll(WatchStatus status) {
        List<Object> params = new ArrayList<Object>();
        String sql = "SELECT wr.id AS wr_id, wr.status, wr.watched_episodes, wr.created_at AS wr_created_at, "
                + "wr.updated_at AS wr_updated_at, a.* FROM watch_records wr "
                + "JOIN anime_sources a ON a.id = wr.anime_source_id ";
        if (status != null) {
            sql += "WHERE wr.status = ? ";
            params.add(status.name());
        }
        sql += "ORDER BY wr.updated_at DESC";
        return jdbcTemplate.query(sql, params.toArray(), rowMapper());
    }

    public WatchRecord findById(long id) {
        List<WatchRecord> results = jdbcTemplate.query(
                "SELECT wr.id AS wr_id, wr.status, wr.watched_episodes, wr.created_at AS wr_created_at, "
                        + "wr.updated_at AS wr_updated_at, a.* FROM watch_records wr "
                        + "JOIN anime_sources a ON a.id = wr.anime_source_id WHERE wr.id = ?",
                rowMapper(),
                id);
        return results.isEmpty() ? null : results.get(0);
    }

    public WatchRecord upsert(long animeSourceId, WatchStatus status, int watchedEpisodes) {
        String now = Instant.now().toString();
        int updated = jdbcTemplate.update(
                "UPDATE watch_records SET status = ?, watched_episodes = ?, updated_at = ? WHERE anime_source_id = ?",
                status.name(),
                watchedEpisodes,
                now,
                animeSourceId);
        if (updated == 0) {
            jdbcTemplate.update(
                    "INSERT INTO watch_records (anime_source_id, status, watched_episodes, created_at, updated_at) "
                            + "VALUES (?, ?, ?, ?, ?)",
                    animeSourceId,
                    status.name(),
                    watchedEpisodes,
                    now,
                    now);
        }
        Long id = jdbcTemplate.queryForObject(
                "SELECT id FROM watch_records WHERE anime_source_id = ?",
                Long.class,
                animeSourceId);
        return findById(id);
    }

    public WatchRecord update(long id, WatchStatus status, Integer watchedEpisodes) {
        WatchRecord current = findById(id);
        if (current == null) {
            return null;
        }
        WatchStatus nextStatus = status == null ? current.getStatus() : status;
        int nextEpisodes = watchedEpisodes == null ? current.getWatchedEpisodes() : watchedEpisodes.intValue();
        jdbcTemplate.update(
                "UPDATE watch_records SET status = ?, watched_episodes = ?, updated_at = ? WHERE id = ?",
                nextStatus.name(),
                nextEpisodes,
                Instant.now().toString(),
                id);
        return findById(id);
    }

    public void delete(long id) {
        jdbcTemplate.update("DELETE FROM watch_records WHERE id = ?", id);
    }

    private RowMapper<WatchRecord> rowMapper() {
        return new RowMapper<WatchRecord>() {
            @Override
            public WatchRecord mapRow(ResultSet rs, int rowNum) throws SQLException {
                AnimeSource anime = new AnimeSource();
                anime.setId(rs.getLong("id"));
                anime.setSeason(rs.getString("season"));
                anime.setTitle(rs.getString("title"));
                anime.setImageUrl(rs.getString("image_url"));
                anime.setAirDay(rs.getString("air_day"));
                anime.setAirTime(rs.getString("air_time"));
                int episodes = rs.getInt("total_episodes");
                anime.setTotalEpisodes(rs.wasNull() ? null : episodes);
                anime.setSourceUrl(rs.getString("source_url"));
                anime.setCreatedAt(rs.getString("created_at"));
                anime.setUpdatedAt(rs.getString("updated_at"));

                WatchRecord record = new WatchRecord();
                record.setId(rs.getLong("wr_id"));
                record.setAnime(anime);
                record.setStatus(WatchStatus.valueOf(rs.getString("status")));
                record.setWatchedEpisodes(rs.getInt("watched_episodes"));
                record.setCreatedAt(rs.getString("wr_created_at"));
                record.setUpdatedAt(rs.getString("wr_updated_at"));
                return record;
            }
        };
    }
}
