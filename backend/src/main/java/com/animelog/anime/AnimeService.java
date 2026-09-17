package com.animelog.anime;

import java.io.IOException;
import java.util.ArrayList;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

import com.animelog.config.AnimeLogProperties;
import org.springframework.stereotype.Service;

@Service
public class AnimeService {
    private final AnimeRepository animeRepository;
    private final YucWikiClient yucWikiClient;
    private final YucWikiParser yucWikiParser;
    private final AnimeLogProperties properties;

    public AnimeService(
            AnimeRepository animeRepository,
            YucWikiClient yucWikiClient,
            YucWikiParser yucWikiParser,
            AnimeLogProperties properties) {
        this.animeRepository = animeRepository;
        this.yucWikiClient = yucWikiClient;
        this.yucWikiParser = yucWikiParser;
        this.properties = properties;
    }

    public List<AnimeSource> listSeason(String season) {
        refreshIfStale(season);
        return animeRepository.findBySeason(season);
    }

    public List<AnimeSource> refresh(String season) {
        try {
            String pageUrl = yucWikiClient.pageUrl(season);
            List<ParsedAnime> parsed = yucWikiParser.parse(yucWikiClient.fetchSeasonHtml(season), pageUrl);
            List<String> sourceUrls = new ArrayList<String>();
            for (ParsedAnime anime : parsed) {
                sourceUrls.add(anime.getSourceUrl());
                animeRepository.upsertFromParsed(season, anime);
            }
            animeRepository.deleteUnwatchedSourcesOutside(season, sourceUrls);
            animeRepository.markRefreshed(season);
            return animeRepository.findBySeason(season);
        } catch (IOException ex) {
            throw new YucWikiRefreshException("刷新 yuc.wiki 失败：" + ex.getMessage(), ex);
        }
    }

    private void refreshIfStale(String season) {
        String refreshedAt = animeRepository.findRefreshTime(season);
        if (refreshedAt == null) {
            refresh(season);
            return;
        }

        Instant refreshed = Instant.parse(refreshedAt);
        if (Duration.between(refreshed, Instant.now()).toHours() >= properties.getCacheTtlHours()) {
            refresh(season);
        }
    }
}
