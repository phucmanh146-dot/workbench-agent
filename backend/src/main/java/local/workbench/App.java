package local.workbench;

import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class App {
    public static void main(String[] args) throws Exception {
        Files.createDirectories(Path.of("data"));
        applyProxySettings();
        SpringApplication.run(App.class, args);
    }

    private static void applyProxySettings() {
        String host = System.getenv("WORKBENCH_PROXY_HOST");
        String port = System.getenv("WORKBENCH_PROXY_PORT");
        if (host == null || host.isBlank() || port == null || port.isBlank()) {
            return;
        }
        System.setProperty("http.proxyHost", host);
        System.setProperty("http.proxyPort", port);
        System.setProperty("https.proxyHost", host);
        System.setProperty("https.proxyPort", port);
        String user = System.getenv("WORKBENCH_PROXY_USER");
        String password = System.getenv("WORKBENCH_PROXY_PASSWORD");
        if (user != null && !user.isBlank() && password != null) {
            System.setProperty("http.proxyUser", user);
            System.setProperty("http.proxyPassword", password);
            System.setProperty("https.proxyUser", user);
            System.setProperty("https.proxyPassword", password);
        }
        String directHosts = System.getenv("WORKBENCH_NON_PROXY_HOSTS");
        System.setProperty("http.nonProxyHosts", directHosts == null || directHosts.isBlank()
            ? "localhost|127.0.0.1" : "localhost|127.0.0.1|" + directHosts.strip());
    }
}
