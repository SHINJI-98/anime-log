package com.animelog.config;

import java.util.HashMap;
import java.util.Map;

import com.animelog.anime.YucWikiRefreshException;
import com.animelog.watch.NotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(NotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public Map<String, String> notFound(NotFoundException ex) {
        return error(ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String, String> validation(MethodArgumentNotValidException ex) {
        return error("请求参数无效");
    }

    @ExceptionHandler({ IllegalArgumentException.class })
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Map<String, String> badRequest(RuntimeException ex) {
        return error(ex.getMessage());
    }

    @ExceptionHandler(YucWikiRefreshException.class)
    @ResponseStatus(HttpStatus.BAD_GATEWAY)
    public Map<String, String> refreshFailed(YucWikiRefreshException ex) {
        return error(ex.getMessage());
    }

    private Map<String, String> error(String message) {
        Map<String, String> response = new HashMap<String, String>();
        response.put("message", message);
        return response;
    }
}
