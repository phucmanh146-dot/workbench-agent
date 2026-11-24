package local.workbench;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Locale;
import java.util.zip.ZipInputStream;
import javax.xml.parsers.DocumentBuilderFactory;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

record KnowledgeAttachment(String name, String text, String image) {
    static KnowledgeAttachment read(MultipartFile file) {
        if (file == null || file.isEmpty()) return new KnowledgeAttachment("","",null);
        if (file.getSize() > 4 * 1024 * 1024) throw invalid("附件不能超过 4 MB。");
        String original = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().replace('\\','/');
        String name = original.substring(original.lastIndexOf('/')+1);
        try {
            return read(name,file.getBytes());
        } catch(IOException ex) {
            throw invalid("无法读取此附件，请检查文件是否损坏或加密。");
        }
    }

    static KnowledgeAttachment read(String name,byte[] bytes) {
        if(bytes.length>4*1024*1024)throw invalid("附件不能超过 4 MB。");
        String extension = name.substring(name.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
        try {
            if ("png".equals(extension) || "jpg".equals(extension) || "jpeg".equals(extension)) {
                boolean png=bytes.length>8 && bytes[0]==(byte)0x89 && bytes[1]=='P' && bytes[2]=='N' && bytes[3]=='G';
                boolean jpeg=bytes.length>3 && bytes[0]==(byte)0xff && bytes[1]==(byte)0xd8 && bytes[2]==(byte)0xff;
                if (!png && !jpeg) throw invalid("图片格式无效，请上传 PNG 或 JPEG。");
                return new KnowledgeAttachment(name,"","data:image/"+(png?"png":"jpeg")+";base64,"+Base64.getEncoder().encodeToString(bytes));
            }
            String text=switch(extension) {
                case "txt","md","csv" -> new String(bytes,StandardCharsets.UTF_8);
                case "pdf" -> pdf(bytes);
                case "docx" -> docx(bytes);
                default -> throw invalid("支持 TXT、MD、CSV、DOCX、可复制文字的 PDF 和 PNG/JPEG 图片。");
            };
            if (text.isBlank()) throw invalid("附件中没有可读取的文本。扫描版 PDF 可以改传截图。");
            return new KnowledgeAttachment(name,text.substring(0,Math.min(text.length(),24000)),null);
        } catch (IOException | javax.xml.parsers.ParserConfigurationException | org.xml.sax.SAXException ex) {
            throw invalid("无法读取此附件，请检查文件是否损坏或加密。");
        }
    }

    private static String pdf(byte[] bytes) throws IOException {
        try (var document=Loader.loadPDF(bytes)) {
            var reader=new PDFTextStripper();
            reader.setEndPage(Math.min(60,document.getNumberOfPages()));
            return reader.getText(document);
        }
    }

    private static String docx(byte[] bytes)
        throws IOException,javax.xml.parsers.ParserConfigurationException,org.xml.sax.SAXException {
        try (var archive=new ZipInputStream(new ByteArrayInputStream(bytes))) {
            java.util.zip.ZipEntry entry;
            while ((entry=archive.getNextEntry())!=null) {
                if (!"word/document.xml".equals(entry.getName())) continue;
                byte[] xml=archive.readNBytes(4*1024*1024+1);
                if (xml.length>4*1024*1024) throw invalid("DOCX 正文过大，请拆分后上传。");
                var factory=DocumentBuilderFactory.newInstance();
                factory.setNamespaceAware(true);
                factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
                factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD,"");
                factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA,"");
                var document=factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml));
                String namespace="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
                var paragraphs=document.getElementsByTagNameNS(namespace,"p");
                var text=new StringBuilder();
                for(int i=0;i<paragraphs.getLength();i++){
                    var parts=((org.w3c.dom.Element)paragraphs.item(i)).getElementsByTagNameNS(namespace,"t");
                    for(int j=0;j<parts.getLength();j++)text.append(parts.item(j).getTextContent());
                    text.append('\n');
                }
                return text.toString();
            }
        }
        return "";
    }

    private static ResponseStatusException invalid(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST,message);
    }
}
