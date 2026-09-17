package com.animelog.watch;

import java.util.List;

import javax.validation.Valid;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/watch-records")
public class WatchRecordController {
    private final WatchRecordRepository watchRecordRepository;
    private final WatchRecordService watchRecordService;

    public WatchRecordController(WatchRecordRepository watchRecordRepository, WatchRecordService watchRecordService) {
        this.watchRecordRepository = watchRecordRepository;
        this.watchRecordService = watchRecordService;
    }

    @GetMapping
    public List<WatchRecord> list(@RequestParam(required = false) WatchStatus status) {
        return watchRecordRepository.findAll(status);
    }

    @PostMapping
    public WatchRecord create(@Valid @RequestBody WatchRecordRequest request) {
        return watchRecordService.addOrUpdate(request);
    }

    @PatchMapping("/{id}")
    public WatchRecord update(@PathVariable long id, @Valid @RequestBody WatchRecordUpdateRequest request) {
        return watchRecordService.update(id, request);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable long id) {
        watchRecordService.delete(id);
    }
}
