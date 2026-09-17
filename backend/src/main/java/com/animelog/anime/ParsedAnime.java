package com.animelog.anime;

public class ParsedAnime {
    private final String title;
    private final String imageUrl;
    private final String airDay;
    private final String airTime;
    private final Integer totalEpisodes;
    private final String sourceUrl;

    public ParsedAnime(String title, String imageUrl, String airTime, Integer totalEpisodes, String sourceUrl) {
        this(title, imageUrl, null, airTime, totalEpisodes, sourceUrl);
    }

    public ParsedAnime(String title, String imageUrl, String airDay, String airTime, Integer totalEpisodes, String sourceUrl) {
        this.title = title;
        this.imageUrl = imageUrl;
        this.airDay = airDay;
        this.airTime = airTime;
        this.totalEpisodes = totalEpisodes;
        this.sourceUrl = sourceUrl;
    }

    public String getTitle() {
        return title;
    }

    public String getImageUrl() {
        return imageUrl;
    }

    public String getAirDay() {
        return airDay;
    }

    public String getAirTime() {
        return airTime;
    }

    public Integer getTotalEpisodes() {
        return totalEpisodes;
    }

    public String getSourceUrl() {
        return sourceUrl;
    }
}
