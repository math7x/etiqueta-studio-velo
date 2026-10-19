using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Reflection;
using System.Net;
using System.Text;
using System.Security.Cryptography;
[assembly: AssemblyTitle("Etiqueta Studio")]
[assembly: AssemblyDescription("Editor portátil de etiquetas JRXML e JASPER — arquivo único")]
[assembly: AssemblyVersion("1.0.0.0")]
static class Launcher {
  static Stream Payload(){return Assembly.GetExecutingAssembly().GetManifestResourceStream("EtiquetaStudio.Payload");}
  static string PrepareHome(){
    string version;
    using(Stream source=Payload())using(SHA256 hash=SHA256.Create()){
      if(source==null)throw new Exception("O executável está incompleto. Copie novamente o arquivo Etiqueta Studio.exe.");
      version=BitConverter.ToString(hash.ComputeHash(source)).Replace("-","").Substring(0,24);
    }
    string home=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"EtiquetaStudio","Runtime",version);
    Directory.CreateDirectory(home);
    using(var mutex=new System.Threading.Mutex(false,"Local\\EtiquetaStudio_"+version)){
      bool acquired=false;
      try{
        try{acquired=mutex.WaitOne(120000);}catch(System.Threading.AbandonedMutexException){acquired=true;}
        if(!acquired)throw new Exception("Outra abertura do programa ainda está sendo preparada. Tente novamente em instantes.");
        string ready=Path.Combine(home,".ready");
        if(!File.Exists(ready)||!File.Exists(Path.Combine(home,"java","bin","java.exe"))||!File.Exists(Path.Combine(home,"EtiquetaStudio.jar"))||!File.Exists(Path.Combine(home,"app","index.html"))){
          string root=Path.GetFullPath(home)+Path.DirectorySeparatorChar;
          using(Stream source=Payload())using(var zip=new ZipArchive(source,ZipArchiveMode.Read))foreach(var entry in zip.Entries){
            string destination=Path.GetFullPath(Path.Combine(home,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
            if(!destination.StartsWith(root,StringComparison.OrdinalIgnoreCase))throw new Exception("Arquivo interno inválido.");
            if(String.IsNullOrEmpty(entry.Name)){Directory.CreateDirectory(destination);continue;}
            Directory.CreateDirectory(Path.GetDirectoryName(destination));
            using(Stream input=entry.Open())using(Stream output=new FileStream(destination,FileMode.Create,FileAccess.Write,FileShare.None))input.CopyTo(output);
          }
          File.WriteAllText(ready,version,Encoding.UTF8);
        }
      }finally{if(acquired)mutex.ReleaseMutex();}
    }
    return home;
  }
  [STAThread] static void Main(string[] args){
    try{
      string home=PrepareHome(),java=Path.Combine(home,"java","bin","java.exe"),libs=Path.Combine(home,"lib");
      AppDomain.CurrentDomain.AssemblyResolve+=(sender,eventArgs)=>{
        string name=new AssemblyName(eventArgs.Name).Name;
        if(name!="Microsoft.Web.WebView2.Core"&&name!="Microsoft.Web.WebView2.WinForms")return null;
        return Assembly.LoadFrom(Path.Combine(home,"desktop",name+".dll"));
      };
      ProcessStartInfo start=new ProcessStartInfo(java,"-Xmx384m -cp \""+Path.Combine(home,"EtiquetaStudio.jar")+";"+libs+"\\*\" EtiquetaStudio --no-open");
      start.WorkingDirectory=home;start.UseShellExecute=false;start.CreateNoWindow=true;start.WindowStyle=ProcessWindowStyle.Hidden;start.RedirectStandardOutput=true;start.RedirectStandardError=true;
      Process p=Process.Start(start);var errors=new StringBuilder();
      p.ErrorDataReceived+=(s,e)=>{if(e.Data!=null)lock(errors){if(errors.Length<6000)errors.AppendLine(e.Data);}};p.BeginErrorReadLine();
      Task<string> output=Task.Factory.StartNew(()=>p.StandardOutput.ReadLine());
      if(!output.Wait(20000)){try{p.Kill();}catch{}throw new Exception("O editor demorou a iniciar. Tente novamente.");}
      string url=output.Result;
      if(url==null||!url.StartsWith("http://127.0.0.1:")){string error;lock(errors)error=errors.ToString();throw new Exception("Não foi possível iniciar o editor.\n\n"+error);}
      if(args.Length==2&&args[0]=="--self-test"){
        using(WebClient web=new WebClient()){
          web.Encoding=Encoding.UTF8;string status=web.DownloadString(url+"api/status");
          if(!status.Contains("3.7.2"))throw new Exception("Compilador inesperado.");
          string html=web.DownloadString(url);if(!html.Contains("Folha inteira"))throw new Exception("Interface indisponível.");
          string script=web.DownloadString(url+"app.js");if(!script.Contains("simplifyLayout();init();")||script.Contains("function desktopLayout"))throw new Exception("Visual diferente da versão solicitada.");
          string xml=File.ReadAllText(Path.Combine(home,"modelo-teste.jrxml"),Encoding.UTF8);
          string body="sampleCount=31&jrxml="+Uri.EscapeDataString(xml);
          web.Headers["Origin"]=new Uri(url).GetLeftPart(UriPartial.Authority);web.Headers["Content-Type"]="application/x-www-form-urlencoded";
          byte[] preview=web.UploadData(url+"api/preview","POST",Encoding.UTF8.GetBytes(body));
          if(preview.Length<100||web.ResponseHeaders["X-Preview-Pages"]!="2")throw new Exception("Prévia de duas páginas inválida.");
          web.Headers["Origin"]=new Uri(url).GetLeftPart(UriPartial.Authority);web.Headers["Content-Type"]="application/x-www-form-urlencoded";
          byte[] package=web.UploadData(url+"api/export","POST",Encoding.UTF8.GetBytes(body));
          using(var zip=new ZipArchive(new MemoryStream(package),ZipArchiveMode.Read)){
            bool jasper=false,pdf=false,jrxml=false;
            foreach(var entry in zip.Entries){jasper|=entry.FullName.EndsWith(".jasper")&&entry.Length>100;pdf|=entry.FullName.EndsWith(".pdf")&&entry.Length>100;jrxml|=entry.FullName.EndsWith(".jrxml")&&entry.Length>100;}
            if(!jasper||!pdf||!jrxml||zip.Entries.Count!=5)throw new Exception("Pacote de exportação incompleto.");
          }
          web.Headers["Origin"]=new Uri(url).GetLeftPart(UriPartial.Authority);web.UploadString(url+"api/close","POST","");
          File.WriteAllText(args[1],"PASSOU: EXE único; Java e bibliotecas internos; visual anterior; prévia de 31 etiquetas em 2 páginas; compilação, recarga JASPER, PDF e pacote completo; encerramento.\r\nRuntime: "+home+"\r\n"+status,Encoding.UTF8);
        }
      }else if(args.Length==2&&args[0]=="--test-ui")File.WriteAllText(args[1],url,Encoding.UTF8);
      else RunDesktop(home,url,p,args);
    }catch(Exception e){if(args.Length==2&&args[0].StartsWith("--")){File.WriteAllText(args[1],"FALHOU: "+e.ToString(),Encoding.UTF8);Environment.ExitCode=1;}else MessageBox.Show(e.Message,"Etiqueta Studio",MessageBoxButtons.OK,MessageBoxIcon.Information);}
  }
  [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
  static void RunDesktop(string home,string url,Process process,string[] args){
    Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
    string test=args.Length==2&&args[0]=="--desktop-self-test"?args[1]:null;
    Application.Run(new EditorWindow(home,url,process,test));
  }
}
