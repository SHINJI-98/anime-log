package com.animelog.watch;

import javax.validation.constraints.Min;
import javax.validation.constraints.NotNull;

public class WatchRecordRequest {
    @NotNull
    private Long animeSourceId;

    @NotNull
    private WatchStatus status = WatchStatus.watching;

    @Min(0)
    private int watchedEpisodes = 0;

    public Long getAnimeSourceId() {
        return animeSourceId;
    }

    public void setAnimeSourceId(Long animeSourceId) {
        this.animeSourceId = animeSourceId;
    }

    public WatchStatus getStatus() {
        return status;
    }

    public void setStatus(WatchStatus status) {
        this.status = status;
    }

    public int getWatchedEpisodes() {
        return watchedEpisodes;
    }

    public void setWatchedEpisodes(int watchedEpisodes) {
        this.watchedEpisodes = watchedEpisodes;
    }
}
