package com.animelog.watch;

import javax.validation.constraints.Min;

public class WatchRecordUpdateRequest {
    private WatchStatus status;

    @Min(0)
    private Integer watchedEpisodes;

    public WatchStatus getStatus() {
        return status;
    }

    public void setStatus(WatchStatus status) {
        this.status = status;
    }

    public Integer getWatchedEpisodes() {
        return watchedEpisodes;
    }

    public void setWatchedEpisodes(Integer watchedEpisodes) {
        this.watchedEpisodes = watchedEpisodes;
    }
}
