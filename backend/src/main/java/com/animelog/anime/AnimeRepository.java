package com.animelog.anime;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class AnimeRepository {
    private final JdbcTemplate jdbcTemplate;

    public AnimeRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public List<AnimeSource> findBySeason(String season) {
        return jdbcTemplate.query(
                "SELECT * FROM anime_sources WHERE season = ? ORDER BY "
                        + "CASE air_day "
                        + "WHEN '周一 (月)' THEN 1 "
                        + "WHEN '周二 (火)' THEN 2 "
                        + "WHEN '周三 (水)' THEN 3 "
                        + "WHEN '周四 (木)' THEN 4 "
                        + "WHEN '周五 (金)' THEN 5 "
                        + "WHEN '周六 (土)' THEN 6 "
                        + "WHEN '周日 (日)' THEN 7 "
                        + "WHEN '网络播放 & 其他' THEN 8 "
                        + "WHEN '其他' THEN 9 "
                        + "ELSE 10 END, air_time IS NULL, air_time, title",
                animeRowMapper(),
                season);
    }

    public AnimeSource findById(long id) {
        List<AnimeSource> results = jdbcTemplate.query(
                "SELECT * FROM anime_sources WHERE id = ?",
                animeRowMapper(),
                id);
        return results.isEmpty() ? null : results.get(0);
    }

    public void upsertFromParsed(String season, ParsedAnime anime) {
        String now = Instant.now().toString();
        int updated = jdbcTemplate.update(
                "UPDATE anime_sources SET season = ?, title = ?, image_url = ?, air_day = ?, air_time = ?, "
                        + "total_episodes = ?, updated_at = ? WHERE source_url = ?",
                season,
                anime.getTitle(),
                anime.getImageUrl(),
                anime.getAirDay(),
                anime.getAirTime(),
                anime.getTotalEpisodes(),
                now,
                anime.getSourceUrl());
        if (updated == 0) {
            jdbcTemplate.update(
                    "INSERT INTO anime_sources "
                            + "(season, title, image_url, air_day, air_time, total_episodes, source_url, created_at, updated_at) "
                            + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    season,
                    anime.getTitle(),
                    anime.getImageUrl(),
                    anime.getAirDay(),
                    anime.getAirTime(),
                    anime.getTotalEpisodes(),
                    anime.getSourceUrl(),
                    now,
                    now);
        }
    }

    public String findRefreshTime(String season) {
        List<String> results = jdbcTemplate.query(
                "SELECT refreshed_at FROM season_refreshes WHERE season = ?",
                (rs, rowNum) -> rs.getString("refreshed_at"),
                season);
        return results.isEmpty() ? null : results.get(0);
    }

    public void markRefreshed(String season) {
        String now = Instant.now().toString();
        int updated = jdbcTemplate.update(
                "UPDATE season_refreshes SET refreshed_at = ? WHERE season = ?",
                now,
                season);
        if (updated == 0) {
            jdbcTemplate.update(
                    "INSERT INTO season_refreshes (season, refreshed_at) VALUES (?, ?)",
                    season,
                    now);
        }
    }

    public void deleteUnwatchedSourcesOutside(String season, List<String> sourceUrls) {
        if (sourceUrls == null || sourceUrls.isEmpty()) {
            return;
        }
        StringBuilder sql = new StringBuilder("DELETE FROM anime_sources WHERE season = ? "
                + "AND source_url NOT IN (");
        List<Object> params = new ArrayList<Object>();
        params.add(season);
        for (int i = 0; i < sourceUrls.size(); i++) {
            if (i > 0) {
                sql.append(", ");
            }
            sql.append("?");
            params.add(sourceUrls.get(i));
        }
        sql.append(") AND id NOT IN (SELECT anime_source_id FROM watch_records)")
                .append(" AND id NOT IN (SELECT anime_source_id FROM anime_notes)");
        jdbcTemplate.update(sql.toString(), params.toArray());
    }

    private RowMapper<AnimeSource> animeRowMapper() {
        return new RowMapper<AnimeSource>() {
            @Override
            public AnimeSource mapRow(ResultSet rs, int rowNum) throws SQLException {
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
                return anime;
            }
        };
    }
}
