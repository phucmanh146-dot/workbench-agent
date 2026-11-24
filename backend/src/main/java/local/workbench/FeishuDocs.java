package local.workbench;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.time.Duration;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.server.ResponseStatusException;

@Component
class FeishuDocs {
    record Document(String token, String url, String title, String content) {}

    private static final String API = "https://open.feishu.cn/open-apis/docx/v1/documents/";
    private final RestClient client;

    FeishuDocs() {
        var timeouts = new SimpleClientHttpRequestFactory();
        timeouts.setConnectTimeout(Duration.ofSeconds(10));
        timeouts.setReadTimeout(Duration.ofSeconds(25));
        client = RestClient.builder().requestFactory(timeouts).build();
    }

    Document read(String input) {
        URI link;
        try {
            link = URI.create(input == null ? "" : input.strip());
        } catch (IllegalArgumentException ex) {
            throw invalidLink();
        }
        String host = link.getHost() == null ? "" : link.getHost().toLowerCase(Locale.ROOT);
        String path = link.getPath();
        if (!"https".equalsIgnoreCase(link.getScheme()) || !host.endsWith(".feishu.cn")
            || link.getUserInfo() != null || (link.getPort() != -1 && link.getPort() != 443)
            || path == null || !path.matches("/docx/[A-Za-z0-9]{1,128}/?")) {
            throw invalidLink();
        }
        String token = path.split("/")[2];
        String access = accessToken();
        try {
            var metadata = get(API + token, access).path("data").path("document");
            String title = metadata.path("title").asText();
            String content = get(API + token + "/raw_content", access).path("data").path("content").asText();
            if (content.isBlank()) throw rejected("飞书文档没有可导入的纯文本内容。");
            return new Document(token, "https://" + host + "/docx/" + token,
                title.isBlank() ? "飞书云文档" : title, content);
        } catch (RestClientException ex) {
            throw rejected("读取飞书文档失败，请检查网络、文档权限和应用配置。");
        }
    }

    private String accessToken() {
        String appId = System.getenv("WORKBENCH_FEISHU_APP_ID");
        String secret = System.getenv("WORKBENCH_FEISHU_APP_SECRET");
        if (appId == null || appId.isBlank() || secret == null || secret.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "请先配置飞书开放平台应用凭证。");
        }
        try {
            var result = client.post().uri("https://accounts.feishu.cn/oauth/v3/token")
                .body(Map.of("grant_type", "client_credentials", "client_id", appId, "client_secret", secret))
                .retrieve().body(JsonNode.class);
            String token = result == null ? "" : result.path("access_token").asText();
            if (token.isBlank()) throw rejected("飞书应用鉴权失败，请检查应用凭证。");
            return token;
        } catch (RestClientException ex) {
            throw rejected("飞书应用鉴权失败，请检查网络和应用凭证。");
        }
    }

    private JsonNode get(String endpoint, String access) {
        JsonNode result = client.get().uri(endpoint).headers(headers -> headers.setBearerAuth(access))
            .retrieve().body(JsonNode.class);
        if (result == null || result.path("code").asInt(-1) != 0) {
            throw rejected("飞书未返回文档，请检查应用的云文档权限和文档授权。");
        }
        return result;
    }

    private static ResponseStatusException invalidLink() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "请粘贴飞书新版云文档链接（/docx/）。");
    }

    private static ResponseStatusException rejected(String message) {
        return new ResponseStatusException(HttpStatus.BAD_GATEWAY, message);
    }
}
