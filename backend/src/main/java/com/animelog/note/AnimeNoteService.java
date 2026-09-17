package com.animelog.note;

import com.animelog.anime.AnimeRepository;
import com.animelog.watch.NotFoundException;
import org.springframework.stereotype.Service;

@Service
public class AnimeNoteService {
    private static final int SUMMARY_EPISODE_NUMBER = 0;

    private final AnimeRepository animeRepository;
    private final AnimeNoteRepository animeNoteRepository;

    public AnimeNoteService(AnimeRepository animeRepository, AnimeNoteRepository animeNoteRepository) {
        this.animeRepository = animeRepository;
        this.animeNoteRepository = animeNoteRepository;
    }

    public AnimeNotesResponse findByAnimeSourceId(long animeSourceId) {
        requireAnime(animeSourceId);
        return animeNoteRepository.findByAnimeSourceId(animeSourceId);
    }

    public AnimeNote saveSummary(long animeSourceId, AnimeNoteRequest request) {
        requireAnime(animeSourceId);
        return animeNoteRepository.upsert(animeSourceId, SUMMARY_EPISODE_NUMBER, request.getContent());
    }

    public AnimeNote saveEpisode(long animeSourceId, int episodeNumber, AnimeNoteRequest request) {
        requireAnime(animeSourceId);
        requireEpisode(episodeNumber);
        return animeNoteRepository.upsert(animeSourceId, episodeNumber, request.getContent());
    }

    public void deleteEpisode(long animeSourceId, int episodeNumber) {
        requireAnime(animeSourceId);
        requireEpisode(episodeNumber);
        animeNoteRepository.deleteEpisode(animeSourceId, episodeNumber);
    }

    private void requireAnime(long animeSourceId) {
        if (animeRepository.findById(animeSourceId) == null) {
            throw new NotFoundException("番剧不存在");
        }
    }

    private void requireEpisode(int episodeNumber) {
        if (episodeNumber < 1) {
            throw new IllegalArgumentException("集数必须大于 0");
        }
    }
}
