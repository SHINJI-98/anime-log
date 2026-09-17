package com.animelog.anime;

import java.io.IOException;

import com.animelog.config.AnimeLogProperties;
import org.jsoup.Jsoup;
import org.springframework.stereotype.Component;

@Component
public class YucWikiClient {
    private final AnimeLogProperties properties;

    public YucWikiClient(AnimeLogProperties properties) {
        this.properties = properties;
    }

    public String pageUrl(String season) {
        return trimTrailingSlash(properties.getYucBaseUrl()) + "/" + season + "/";
    }

    public String fetchSeasonHtml(String season) throws IOException {
        return Jsoup.connect(pageUrl(season))
                .userAgent("AnimeLog/0.1 (+local personal anime tracker)")
                .timeout(15000)
                .get()
                .outerHtml();
    }

    private String trimTrailingSlash(String value) {
        if (value == null || value.endsWith("/")) {
            return value == null ? "" : value.substring(0, value.length() - 1);
        }
        return value;
    }
}
