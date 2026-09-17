package com.animelog.watch;

import com.animelog.anime.AnimeRepository;
import org.springframework.stereotype.Service;

@Service
public class WatchRecordService {
    private final WatchRecordRepository watchRecordRepository;
    private final AnimeRepository animeRepository;

    public WatchRecordService(WatchRecordRepository watchRecordRepository, AnimeRepository animeRepository) {
        this.watchRecordRepository = watchRecordRepository;
        this.animeRepository = animeRepository;
    }

    public WatchRecord addOrUpdate(WatchRecordRequest request) {
        if (animeRepository.findById(request.getAnimeSourceId()) == null) {
            throw new NotFoundException("番剧不存在");
        }
        return watchRecordRepository.upsert(
                request.getAnimeSourceId(),
                request.getStatus(),
                request.getWatchedEpisodes());
    }

    public WatchRecord update(long id, WatchRecordUpdateRequest request) {
        WatchRecord updated = watchRecordRepository.update(id, request.getStatus(), request.getWatchedEpisodes());
        if (updated == null) {
            throw new NotFoundException("追番记录不存在");
        }
        return updated;
    }

    public void delete(long id) {
        watchRecordRepository.delete(id);
    }
}
