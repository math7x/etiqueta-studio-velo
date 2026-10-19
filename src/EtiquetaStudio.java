import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.awt.Desktop;
import java.awt.image.BufferedImage;
import java.math.BigDecimal;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.*;
import javax.imageio.ImageIO;
import javax.xml.parsers.*;
import org.w3c.dom.*;
import net.sf.jasperreports.engine.*;
import net.sf.jasperreports.engine.data.JRMapCollectionDataSource;
import net.sf.jasperreports.engine.util.JRSaver;
import net.sf.jasperreports.engine.util.JRLoader;
import com.lowagie.text.pdf.*;

/** Local-only editor bridge. Never connects to the application database. */
public final class EtiquetaStudio {
  static final String QUERY="CALL prc_geraEtiquetaImprimir($P{produtoUnicoId},$P{produtoGradeUnicoId},$P{totalEtiquetas}, $P{elevaEmpresaId}, $P{veloId})";
  static final Set<String> FIELDS=new HashSet<String>(Arrays.asList("produtoNome","codigoProduto","codBarras","precoVenda","unidadeVenda","produtoDescricao","coluna","linha","produtoMarca"));
  static final Set<String> TAGS=new HashSet<String>(Arrays.asList("jasperReport","property","parameter","defaultValueExpression","queryString","field","background","detail","band","staticText","textField","text","textElement","font","textFieldExpression","componentElement","reportElement","printWhenExpression","barbecue","codeExpression","line","graphicElement","pen","rectangle"));
  static HttpServer server;
  static ExecutorService pool;
  static String prefix;
  static int port;
  static File home;
  static synchronized void validate(String xml) throws Exception {
    if(xml.length()>400000 || xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY")) throw new Exception("Arquivo XML não permitido.");
    DocumentBuilderFactory f=DocumentBuilderFactory.newInstance(); f.setNamespaceAware(true);
    f.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
    f.setFeature("http://xml.org/sax/features/external-general-entities",false);
    f.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
    Document d=f.newDocumentBuilder().parse(new ByteArrayInputStream(xml.getBytes("UTF-8")));
    Element root=d.getDocumentElement();
    if(!"jasperReport".equals(root.getLocalName()) || (root.hasAttribute("language") && !"java".equals(root.getAttribute("language")))) throw new Exception("Use um modelo JasperReports Java suportado pelo editor.");
    if(root.hasAttribute("scriptletClass") || root.hasAttribute("formatFactoryClass")) throw new Exception("Classes externas não são suportadas.");
    int w=Integer.parseInt(root.getAttribute("pageWidth")),h=Integer.parseInt(root.getAttribute("pageHeight"));
    int cols=Integer.parseInt(root.getAttribute("columnCount"));
    if(w<10||w>1700||h<10||h>1700||cols<1||cols>10) throw new Exception("Dimensões fora dos limites do editor.");
    NodeList all=d.getElementsByTagName("*");
    if(all.getLength()>7000) throw new Exception("Modelo muito grande.");
    for(int i=0;i<all.getLength();i++) {
      Element e=(Element)all.item(i); String tag=e.getLocalName(), text=e.getTextContent().trim();
      if(!TAGS.contains(tag)) throw new Exception("Elemento não suportado: "+tag);
      if("queryString".equals(tag) && !text.replaceAll("\\s+", "").equals(QUERY.replaceAll("\\s+", ""))) throw new Exception("A consulta deve manter a integração original do sistema.");
      if("property".equals(tag) && !e.getAttribute("name").startsWith("ireport.")) throw new Exception("Propriedade externa não suportada.");
      if("font".equals(tag) && !Arrays.asList("","SansSerif","Arial","Serif","Monospaced").contains(e.getAttribute("fontName"))) throw new Exception("Fonte não suportada.");
      if("field".equals(tag) && (!FIELDS.contains(e.getAttribute("name")) || !e.getAttribute("class").equals(e.getAttribute("name").equals("precoVenda")?"java.math.BigDecimal":"java.lang.String"))) throw new Exception("Campo não suportado.");
      if("parameter".equals(tag)) {
        String n=e.getAttribute("name"); boolean integer=n.equals("totalEtiquetas")||n.equals("veloId");
        if(!Arrays.asList("produtoUnicoId","produtoGradeUnicoId","totalEtiquetas","elevaEmpresaId","veloId").contains(n)||!e.getAttribute("class").equals(integer?"java.lang.Integer":"java.lang.String")) throw new Exception("Parâmetro não suportado.");
      }
      if("defaultValueExpression".equals(tag) && !Arrays.asList("","1","\"1\"").contains(text)) throw new Exception("Valor padrão não suportado.");
      if("textFieldExpression".equals(tag) && !(text.matches("\\$F\\{[a-zA-Z]+\\}")&&FIELDS.contains(text.substring(3,text.length()-1)))) throw new Exception("Expressão de campo não suportada.");
      if("textFieldExpression".equals(tag) && !e.getAttribute("class").equals(text.equals("$F{precoVenda}")?"java.math.BigDecimal":"java.lang.String")) throw new Exception("Tipo de expressão não suportado.");
      if("printWhenExpression".equals(tag)) {
        boolean band="band".equals(e.getParentNode().getLocalName()) && text.contains("$V{REPORT_COUNT}.intValue()") && text.replace("$V{REPORT_COUNT}.intValue()", "1").matches("[0-9() +*/%!=<>&|\\-]+");
        if(!band && !text.equals("$F{codBarras} != null && $F{codBarras}.matches(\"[0-9]{13}\")") && !text.equals("$F{codBarras}.length() == 13")) throw new Exception("Condição não suportada.");
      }
      if("codeExpression".equals(tag) && !text.equals("$F{codBarras}.substring(0,12)") && !text.equals("$F{codBarras}.substring(0,$F{codBarras}.length() - 1)")) throw new Exception("Expressão de barras não suportada.");
      if("barbecue".equals(tag) && !e.getAttribute("type").equals("EAN13")) throw new Exception("Esta versão suporta EAN-13.");
    }
  }
  static JasperReport compile(String xml) throws Exception {
    validate(xml);
    return JasperCompileManager.compileReport(new ByteArrayInputStream(xml.getBytes("UTF-8")));
  }
  static JasperPrint fill(JasperReport r, Map<String,String> form) throws Exception {
    List<Map<String,Object>> rows=new ArrayList<Map<String,Object>>();
    String name=val(form,"sampleName","CAFÉ ESPECIAL TORRADO 250g");
    String code=val(form,"sampleCode","7891234567895");
    if(!code.matches("[0-9]{13}")) throw new Exception("A amostra de código deve ter 13 números.");
    int sum=0; for(int i=0;i<12;i++) sum+=(code.charAt(i)-'0')*(i%2==0?1:3);
    if((10-sum%10)%10!=code.charAt(12)-'0') throw new Exception("Dígito verificador EAN-13 incorreto na amostra.");
    BigDecimal price=new BigDecimal(val(form,"samplePrice","19.90").replace(',','.'));
    int count=Integer.parseInt(val(form,"sampleCount",String.valueOf(capacity(r))));
    if(count<1||count>1200)throw new Exception("Use de 1 a 1200 etiquetas fictícias.");
    for(int i=0;i<count;i++) {
      Map<String,Object> row=new HashMap<String,Object>(); for(String field:FIELDS) row.put(field,"");
      row.put("produtoNome",String.format("%03d · ",i+1)+name);row.put("codBarras",code);row.put("precoVenda",price);
      row.put("codigoProduto",String.format("%06d",i+1));row.put("produtoMarca","Marca exemplo");row.put("unidadeVenda","UN");row.put("produtoDescricao","Descrição do produto");row.put("coluna",String.valueOf(i%r.getColumnCount()+1));row.put("linha",String.valueOf((i/r.getColumnCount())%(capacity(r)/r.getColumnCount())+1));rows.add(row);
    }
    Map<String,Object> p=new HashMap<String,Object>();p.put("REPORT_LOCALE",new Locale("pt","BR"));
    p.put("produtoUnicoId","");p.put("produtoGradeUnicoId","");p.put("elevaEmpresaId","1");p.put("veloId",1);p.put("totalEtiquetas",rows.size());
    return JasperFillManager.fillReport(r,p,new JRMapCollectionDataSource(rows));
  }
  static String val(Map<String,String> m,String k,String fallback){return m.containsKey(k)?m.get(k):fallback;}
  static int capacity(JasperReport r){String rows=r.getPropertiesMap().getProperty("ireport.etiquetaStudio.rows");return r.getColumnCount()*(rows==null?1:Integer.parseInt(rows));}
  static byte[] calibration(JasperReport r)throws Exception {
    ByteArrayOutputStream out=new ByteArrayOutputStream();com.lowagie.text.Document doc=new com.lowagie.text.Document(new com.lowagie.text.Rectangle(r.getPageWidth(),r.getPageHeight()),0,0,0,0);
    PdfWriter writer=PdfWriter.getInstance(doc,out);doc.open();PdfContentByte cb=writer.getDirectContent();
    String rowTops=r.getPropertiesMap().getProperty("ireport.etiquetaStudio.rowTops"),lh=r.getPropertiesMap().getProperty("ireport.etiquetaStudio.labelHeight");
    String[] tops=rowTops==null?new String[]{"0"}:rowTops.split(",");int labelHeight=lh==null?r.getDetailSection().getBands()[0].getHeight():Integer.parseInt(lh);
    BaseFont font=BaseFont.createFont(BaseFont.HELVETICA,BaseFont.WINANSI,false);cb.setLineWidth(.4f);
    for(int row=0;row<tops.length;row++)for(int col=0;col<r.getColumnCount();col++) {
      float x=r.getLeftMargin()+col*(r.getColumnWidth()+r.getColumnSpacing()),y=r.getPageHeight()-r.getTopMargin()-Integer.parseInt(tops[row])-labelHeight;
      cb.rectangle(x,y,r.getColumnWidth(),labelHeight);cb.stroke();cb.beginText();cb.setFontAndSize(font,7);cb.setTextMatrix(x+4,y+labelHeight-10);cb.showText("L"+(row+1)+" / C"+(col+1)+"  #"+(row*r.getColumnCount()+col+1));cb.endText();
      cb.moveTo(x+3,y+labelHeight/2f);cb.lineTo(x+9,y+labelHeight/2f);cb.moveTo(x+6,y+labelHeight/2f-3);cb.lineTo(x+6,y+labelHeight/2f+3);cb.stroke();
    }
    if(r.getPageWidth()>310&&r.getPageHeight()>100){
      float y=12,x=20,length=100*72/25.4f;cb.moveTo(x,y);cb.lineTo(x+length,y);cb.moveTo(x,y-3);cb.lineTo(x,y+3);cb.moveTo(x+length,y-3);cb.lineTo(x+length,y+3);cb.stroke();
      cb.beginText();cb.setFontAndSize(font,7);cb.setTextMatrix(x,y+5);cb.showText("10 cm — tamanho real 100%; desativar ajustar à página");cb.endText();
    }
    doc.close();return out.toByteArray();
  }
  static void zip(ZipOutputStream z,String n,byte[] bytes)throws Exception{z.putNextEntry(new ZipEntry(n));z.write(bytes);z.closeEntry();}
  static byte[] export(String xml,Map<String,String> form)throws Exception {
    JasperReport r=compile(xml); ByteArrayOutputStream compiled=new ByteArrayOutputStream(); JRSaver.saveObject(r,compiled);
    JasperReport loaded=(JasperReport)JRLoader.loadObject(new ByteArrayInputStream(compiled.toByteArray()));
    JasperPrint print=fill(loaded,form);ByteArrayOutputStream out=new ByteArrayOutputStream();ZipOutputStream z=new ZipOutputStream(out);
    String name=r.getName().replaceAll("[^a-zA-Z0-9_-]","_");
    zip(z,name+".jrxml",xml.getBytes("UTF-8"));zip(z,name+".jasper",compiled.toByteArray());
    zip(z,"PREVIA-com-dados-ficticios.pdf",JasperExportManager.exportReportToPdf(print));
    zip(z,"CALIBRACAO-imprimir-em-100-por-cento.pdf",calibration(loaded));
    zip(z,"LEIA-ME.txt",("Arquivos compilados com JasperReports 3.7.2, instalado no iReport deste computador.\r\nA prévia usa dados fictícios, sem conexão ao banco.\r\nConsulta, parâmetros e campos mantêm o contrato do modelo fornecido.\r\nValide no seu sistema e na impressora antes de substituir um modelo em uso.\r\n").getBytes("UTF-8"));z.close();return out.toByteArray();
  }
  static byte[] read(InputStream in,int limit)throws Exception{try{ByteArrayOutputStream b=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1){b.write(buf,0,n);if(b.size()>limit)throw new Exception("Arquivo muito grande.");}return b.toByteArray();}finally{in.close();}}
  static void send(HttpExchange x,int status,String type,byte[] b)throws IOException{
    x.getResponseHeaders().set("Content-Type",type);x.getResponseHeaders().set("Cache-Control","no-store");x.getResponseHeaders().set("X-Content-Type-Options","nosniff");
    x.getResponseHeaders().set("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    x.sendResponseHeaders(status,b.length);OutputStream o=x.getResponseBody();o.write(b);o.close();
  }
  static void handle(HttpExchange x)throws IOException{
    try {
      if(!("127.0.0.1:"+port).equals(x.getRequestHeaders().getFirst("Host"))) {send(x,403,"text/plain",new byte[0]);return;}
      String path=x.getRequestURI().getPath();if(!path.startsWith(prefix)){send(x,404,"text/plain",new byte[0]);return;}path=path.substring(prefix.length());
      if("GET".equals(x.getRequestMethod())){
        if(path.equals("api/status")){send(x,200,"text/plain; charset=utf-8","JasperReports 3.7.2 • pronto para compilar".getBytes("UTF-8"));return;}
        String file=path.equals("")?"index.html":path;
        if(!Arrays.asList("index.html","core.js","app.js","style.css","a4.css","base.jrxml").contains(file)){send(x,404,"text/plain",new byte[0]);return;}
        String type=file.endsWith("css")?"text/css":file.endsWith("js")?"application/javascript":file.endsWith("jrxml")?"application/xml":"text/html";
        send(x,200,type+"; charset=utf-8",read(new FileInputStream(new File(home,"app/"+file)),1000000));return;
      }
      String origin=x.getRequestHeaders().getFirst("Origin");
      if(!"POST".equals(x.getRequestMethod()) || !("http://127.0.0.1:"+port).equals(origin)){send(x,403,"text/plain",new byte[0]);return;}
      if(path.equals("api/close")){send(x,200,"text/plain","Encerrado".getBytes("UTF-8"));new Thread(new Runnable(){public void run(){server.stop(1);pool.shutdown();}}).start();return;}
      if(!Arrays.asList("api/preview","api/export","api/pdf","api/calibration").contains(path)) {send(x,404,"text/plain",new byte[0]);return;}
      Map<String,String> form=new HashMap<String,String>();String body=new String(read(x.getRequestBody(),1600000),"UTF-8");
      for(String pair:body.split("&")){String[] kv=pair.split("=",2);if(kv.length==2)form.put(URLDecoder.decode(kv[0],"UTF-8"),URLDecoder.decode(kv[1],"UTF-8"));}
      String xml=val(form,"jrxml","");
      synchronized(EtiquetaStudio.class){
        if(path.equals("api/export")){x.getResponseHeaders().set("Content-Disposition","attachment; filename=etiqueta-para-sistema.zip");send(x,200,"application/zip",export(xml,form));}
        else if(path.equals("api/calibration")){send(x,200,"application/pdf",calibration(compile(xml)));}
        else {JasperPrint p=fill(compile(xml),form);if(p.getPages().isEmpty())throw new Exception("A prévia não gerou páginas.");x.getResponseHeaders().set("X-Preview-Pages",String.valueOf(p.getPages().size()));
          if(path.equals("api/pdf")){send(x,200,"application/pdf",JasperExportManager.exportReportToPdf(p));}
          else {int page=Integer.parseInt(val(form,"page","0"));if(page<0||page>=p.getPages().size())throw new Exception("Página inválida.");float scale=p.getPageHeight()>300?1.5f:4f;BufferedImage im=(BufferedImage)JasperPrintManager.printPageToImage(p,page,scale);ByteArrayOutputStream b=new ByteArrayOutputStream();ImageIO.write(im,"png",b);send(x,200,"image/png",b.toByteArray());}
        }
      }
    } catch(Exception e){e.printStackTrace();String msg=e.getMessage();if(msg==null)msg=e.toString();send(x,400,"text/plain; charset=utf-8",msg.getBytes("UTF-8"));}finally{x.close();}
  }
  public static void main(String[] args)throws Exception{
    System.setProperty("java.awt.headless","true");System.setProperty("net.sf.jasperreports.compiler.java","net.sf.jasperreports.engine.design.JRJdtCompiler");
    System.setProperty("org.eclipse.jdt.core.compiler.source","1.5");System.setProperty("org.eclipse.jdt.core.compiler.compliance","1.5");System.setProperty("org.eclipse.jdt.core.compiler.codegen.targetPlatform","1.5");
    home=new File(EtiquetaStudio.class.getProtectionDomain().getCodeSource().getLocation().toURI()).getParentFile();
    if(args.length>0 && args[0].equals("--self-test")){
      String xml=new String(read(new FileInputStream(new File(home,"app/base.jrxml")),200000),"UTF-8");
      byte[] result=export(xml,new HashMap<String,String>());File out=new File(args[1]);FileOutputStream os=new FileOutputStream(out);os.write(result);os.close();
      if(args.length>2){JasperReport old=(JasperReport)JRLoader.loadObject(new File(args[2]));JasperPrint p=fill(old,new HashMap<String,String>());System.out.println("Modelo original carregado: "+old.getName()+"; páginas="+p.getPages().size());}
      System.out.println("OK: compilação, serialização, recarga, preenchimento e PDF; bytes="+result.length);return;
    }
    prefix="/"+UUID.randomUUID().toString().replace("-","")+"/";
    server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);port=server.getAddress().getPort();
    pool=Executors.newFixedThreadPool(2);server.setExecutor(pool);server.createContext("/",new HttpHandler(){public void handle(HttpExchange x)throws IOException{EtiquetaStudio.handle(x);}});server.start();
    String url="http://127.0.0.1:"+port+prefix;System.out.println(url);
    if(args.length==0 || !args[0].equals("--no-open")) {try{Desktop.getDesktop().browse(new URI(url));}catch(Exception e){new ProcessBuilder("rundll32","url.dll,FileProtocolHandler",url).start();}}
  }
}
