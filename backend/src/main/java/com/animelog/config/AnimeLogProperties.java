package com.animelog.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "anime-log")
public class AnimeLogProperties {
    private String databasePath = "data/anime-log.db";
    private String yucBaseUrl = "https://yuc.wiki";
    private int cacheTtlHours = 24;

    public String getDatabasePath() {
        return databasePath;
    }

    public void setDatabasePath(String databasePath) {
        this.databasePath = databasePath;
    }

    public String getYucBaseUrl() {
        return yucBaseUrl;
    }

    public void setYucBaseUrl(String yucBaseUrl) {
        this.yucBaseUrl = yucBaseUrl;
    }

    public int getCacheTtlHours() {
        return cacheTtlHours;
    }

    public void setCacheTtlHours(int cacheTtlHours) {
        this.cacheTtlHours = cacheTtlHours;
    }
}
