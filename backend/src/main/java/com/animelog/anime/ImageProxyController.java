package com.animelog.anime;

import java.io.IOException;
import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.StreamUtils;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

@RestController
@RequestMapping("/api/images")
public class ImageProxyController {
    private static final Set<String> ALLOWED_HOSTS = new HashSet<String>(Arrays.asList(
            "i0.hdslb.com",
            "i1.hdslb.com",
            "i2.hdslb.com",
            "i3.hdslb.com",
            "i4.hdslb.com",
            "i5.hdslb.com"));

    private final RestTemplate restTemplate = new RestTemplate();

    @GetMapping("/proxy")
    public ResponseEntity<byte[]> proxy(@RequestParam String url) throws IOException {
        URI uri = URI.create(url);
        if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))
                || !ALLOWED_HOSTS.contains(uri.getHost())) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).build();
        }
        if ("http".equalsIgnoreCase(uri.getScheme())) {
            uri = URI.create("https://" + uri.getHost() + uri.getRawPath()
                    + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery()));
        }

        ResponseEntity<byte[]> response = restTemplate.getForEntity(uri, byte[].class);
        HttpHeaders headers = new HttpHeaders();
        MediaType contentType = response.getHeaders().getContentType();
        headers.setContentType(contentType == null ? MediaType.IMAGE_JPEG : contentType);
        headers.setCacheControl("public, max-age=86400");
        byte[] body = response.getBody() == null ? new byte[0] : response.getBody();
        return new ResponseEntity<byte[]>(StreamUtils.copyToByteArray(new java.io.ByteArrayInputStream(body)), headers, response.getStatusCode());
    }
}
