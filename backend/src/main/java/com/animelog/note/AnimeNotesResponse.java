package com.animelog.note;

import java.util.ArrayList;
import java.util.List;

public class AnimeNotesResponse {
    private AnimeNote summary;
    private List<AnimeNote> episodeNotes = new ArrayList<AnimeNote>();

    public AnimeNote getSummary() {
        return summary;
    }

    public void setSummary(AnimeNote summary) {
        this.summary = summary;
    }

    public List<AnimeNote> getEpisodeNotes() {
        return episodeNotes;
    }

    public void setEpisodeNotes(List<AnimeNote> episodeNotes) {
        this.episodeNotes = episodeNotes;
    }
}
