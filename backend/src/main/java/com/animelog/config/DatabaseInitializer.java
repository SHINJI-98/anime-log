package com.animelog.config;

import java.io.File;
import java.util.List;
import java.util.Map;

import javax.annotation.PostConstruct;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class DatabaseInitializer {
    private final JdbcTemplate jdbcTemplate;
    private final AnimeLogProperties properties;

    public DatabaseInitializer(JdbcTemplate jdbcTemplate, AnimeLogProperties properties) {
        this.jdbcTemplate = jdbcTemplate;
        this.properties = properties;
    }

    @PostConstruct
    public void initialize() {
        File databaseFile = new File(properties.getDatabasePath());
        File parent = databaseFile.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }

        jdbcTemplate.execute("PRAGMA foreign_keys = ON");
        jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS anime_sources ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                + "season TEXT NOT NULL,"
                + "title TEXT NOT NULL,"
                + "image_url TEXT,"
                + "air_day TEXT,"
                + "air_time TEXT,"
                + "total_episodes INTEGER,"
                + "source_url TEXT NOT NULL,"
                + "created_at TEXT NOT NULL,"
                + "updated_at TEXT NOT NULL,"
                + "UNIQUE(source_url)"
                + ")");
        addColumnIfMissing("anime_sources", "air_day", "TEXT");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_anime_sources_season ON anime_sources(season)");
        jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS season_refreshes ("
                + "season TEXT PRIMARY KEY,"
                + "refreshed_at TEXT NOT NULL"
                + ")");
        jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS watch_records ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                + "anime_source_id INTEGER NOT NULL,"
                + "status TEXT NOT NULL CHECK(status IN ('watching','completed','dropped')),"
                + "watched_episodes INTEGER NOT NULL CHECK(watched_episodes >= 0),"
                + "created_at TEXT NOT NULL,"
                + "updated_at TEXT NOT NULL,"
                + "UNIQUE(anime_source_id),"
                + "FOREIGN KEY(anime_source_id) REFERENCES anime_sources(id) ON DELETE CASCADE"
                + ")");
        jdbcTemplate.execute("CREATE TABLE IF NOT EXISTS anime_notes ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                + "anime_source_id INTEGER NOT NULL,"
                + "episode_number INTEGER NOT NULL CHECK(episode_number >= 0),"
                + "content TEXT NOT NULL,"
                + "created_at TEXT NOT NULL,"
                + "updated_at TEXT NOT NULL,"
                + "UNIQUE(anime_source_id, episode_number),"
                + "FOREIGN KEY(anime_source_id) REFERENCES anime_sources(id) ON DELETE CASCADE"
                + ")");
    }

    private void addColumnIfMissing(String table, String column, String definition) {
        List<Map<String, Object>> columns = jdbcTemplate.queryForList("PRAGMA table_info(" + table + ")");
        for (Map<String, Object> existing : columns) {
            if (column.equalsIgnoreCase(String.valueOf(existing.get("name")))) {
                return;
            }
        }
        jdbcTemplate.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + definition);
    }
}
