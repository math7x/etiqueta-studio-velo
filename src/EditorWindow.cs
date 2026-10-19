using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

sealed class EditorWindow:Form {
  readonly string home,url,testReport;readonly Process engine;readonly WebView2 editor=new WebView2();
  bool closing,shutdownApproved,testStarted;int completedDownloads;
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool SetDllDirectory(string path);
  public EditorWindow(string appHome,string address,Process process,string test){
    home=appHome;url=address;engine=process;testReport=test;
    Text="Etiqueta Studio";StartPosition=FormStartPosition.CenterScreen;MinimumSize=new Size(1100,700);
    Size area=Screen.PrimaryScreen.WorkingArea.Size;ClientSize=new Size(Math.Min(1440,area.Width-70),Math.Min(860,area.Height-90));
    BackColor=Color.FromArgb(17,21,29);Icon=SystemIcons.Application;
    editor.Dock=DockStyle.Fill;editor.DefaultBackgroundColor=BackColor;Controls.Add(editor);
    Shown+=async(s,e)=>await StartEditor();FormClosing+=ClosingEditor;
  }
  async Task StartEditor(){
    try{
      SetDllDirectory(Path.Combine(home,"desktop"));
      string userData=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"EtiquetaStudio","DesktopProfile");
      var environment=await CoreWebView2Environment.CreateAsync(null,userData);
      await editor.EnsureCoreWebView2Async(environment);
      editor.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
      editor.CoreWebView2.Settings.AreDevToolsEnabled=false;
      editor.CoreWebView2.Settings.IsStatusBarEnabled=false;
      editor.CoreWebView2.Settings.IsZoomControlEnabled=false;
      editor.CoreWebView2.NewWindowRequested+=(s,e)=>{e.Handled=true;};
      editor.CoreWebView2.NavigationStarting+=(s,e)=>{if(!e.Uri.StartsWith(url,StringComparison.OrdinalIgnoreCase)&&e.Uri!="about:blank"&&!e.Uri.StartsWith("blob:"))e.Cancel=true;};
      editor.CoreWebView2.DownloadStarting+=SaveDownload;
      editor.CoreWebView2.WebMessageReceived+=SaveNativeFile;
      editor.CoreWebView2.WebResourceResponseReceived+=(s,e)=>{if(e.Request.Uri==url+"api/close"&&e.Response.StatusCode==200){shutdownApproved=true;BeginInvoke(new Action(()=>Close()));}};
      editor.CoreWebView2.NavigationCompleted+=async(s,e)=>{
        if(!e.IsSuccess){Fail(new Exception("Não foi possível carregar o editor. Feche e abra novamente."));return;}
        if(testReport!=null&&!testStarted){testStarted=true;await TestDesktop();}
      };
      editor.CoreWebView2.Navigate(url);
    }catch(Exception e){Fail(e);}
  }
  void SaveNativeFile(object sender,CoreWebView2WebMessageReceivedEventArgs e){
    if(!e.Source.StartsWith(url,StringComparison.OrdinalIgnoreCase))return;
    int id=0;bool saved=false;string error=null;
    try{
      var json=new JavaScriptSerializer();json.MaxJsonLength=16000000;
      var message=json.Deserialize<Dictionary<string,object>>(e.WebMessageAsJson);
      if(!message.ContainsKey("type")||(string)message["type"]!="save-file")return;
      id=Convert.ToInt32(message["id"]);string name=Path.GetFileName((string)message["name"]);
      byte[] data=Convert.FromBase64String((string)message["base64"]);string destination=null;
      if(testReport!=null)destination=Path.Combine(Path.GetDirectoryName(Path.GetFullPath(testReport)),"desktop-"+name);
      else using(var dialog=new SaveFileDialog()){
        dialog.Title="Salvar arquivo — Etiqueta Studio";dialog.FileName=name;dialog.OverwritePrompt=true;dialog.RestoreDirectory=true;
        string extension=Path.GetExtension(name);dialog.Filter=extension==".json"?"Projeto de etiqueta (*.json)|*.json":extension==".zip"?"Modelos para o Velo (*.zip)|*.zip":extension==".pdf"?"Documento PDF (*.pdf)|*.pdf":"Todos os arquivos (*.*)|*.*";
        if(dialog.ShowDialog(this)==DialogResult.OK)destination=dialog.FileName;
      }
      if(destination!=null){File.WriteAllBytes(destination,data);saved=true;completedDownloads++;}
    }catch(Exception ex){error=ex.Message;}
    editor.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(new{type="save-result",id=id,saved=saved,error=error}));
  }
  void SaveDownload(object sender,CoreWebView2DownloadStartingEventArgs e){
    e.Handled=true;string name=Path.GetFileName(e.ResultFilePath);
    if(String.IsNullOrEmpty(name))name="etiqueta";
    if(testReport!=null)e.ResultFilePath=Path.Combine(Path.GetDirectoryName(Path.GetFullPath(testReport)),"desktop-"+name);
    else using(var dialog=new SaveFileDialog()){
      dialog.Title="Salvar arquivo — Etiqueta Studio";dialog.FileName=name;dialog.OverwritePrompt=true;dialog.RestoreDirectory=true;
      string extension=Path.GetExtension(name);dialog.Filter=extension==".json"?"Projeto de etiqueta (*.json)|*.json":extension==".zip"?"Modelos para o Velo (*.zip)|*.zip":extension==".pdf"?"Documento PDF (*.pdf)|*.pdf":"Todos os arquivos (*.*)|*.*";
      if(dialog.ShowDialog(this)!=DialogResult.OK){e.Cancel=true;return;}e.ResultFilePath=dialog.FileName;
    }
    var download=e.DownloadOperation;
    download.StateChanged+=(s,eventArgs)=>{if(download.State==CoreWebView2DownloadState.Completed)completedDownloads++;else if(download.State==CoreWebView2DownloadState.Interrupted&&testReport==null)MessageBox.Show(this,"O arquivo não foi salvo. Tente novamente.","Etiqueta Studio",MessageBoxButtons.OK,MessageBoxIcon.Information);};
  }
  async Task WaitScript(string expression){
    for(int i=0;i<240;i++){if(await editor.ExecuteScriptAsync(expression)=="true")return;await Task.Delay(125);}
    throw new Exception("O teste não recebeu o resultado esperado: "+expression);
  }
  async Task TestDesktop(){
    try{
      await WaitScript("document.getElementById('engineStatus').textContent.includes('3.7.2')");
      if(Handle==IntPtr.Zero||editor.Parent!=this)throw new Exception("Janela independente não foi criada.");
      await editor.ExecuteScriptAsync("document.querySelector('#layers .layer').click();document.getElementById('sampleCount').value=31;document.getElementById('sampleCount').dispatchEvent(new Event('input'));document.getElementById('previewBtn').click();");
      await WaitScript("document.getElementById('previewDialog').open && document.getElementById('pageNumber').textContent==='Página 1 de 2'");
      await editor.ExecuteScriptAsync("document.getElementById('dismissPreview').click();document.getElementById('saveBtn').click();");
      for(int i=0;i<160&&completedDownloads<1;i++)await Task.Delay(100);
      if(completedDownloads<1)throw new Exception("Projeto não foi salvo na janela nativa.");
      await editor.ExecuteScriptAsync("document.getElementById('exportBtn').click();");
      for(int i=0;i<240&&completedDownloads<2;i++)await Task.Delay(125);
      if(completedDownloads<2)throw new Exception("Exportação não concluiu na janela nativa: "+await editor.ExecuteScriptAsync("document.getElementById('status').textContent+' / '+document.getElementById('toast').textContent"));
      string testFolder=Path.GetDirectoryName(Path.GetFullPath(testReport));
      var packages=Directory.GetFiles(testFolder,"desktop-*-para-sistema.zip");if(packages.Length==0)throw new Exception("Pacote não encontrado.");
      using(var zip=new ZipArchive(File.OpenRead(packages[0]),ZipArchiveMode.Read))if(zip.Entries.Count!=5)throw new Exception("Pacote incompleto.");
      File.WriteAllText(testReport,"PASSOU: janela Windows própria, interface incorporada, sem abrir navegador; prévia de 31 etiquetas em 2 páginas; projeto salvo; exportação JRXML/JASPER e PDFs pela janela.\r\nPID: "+Process.GetCurrentProcess().Id+"\r\nJanela: "+Text,Encoding.UTF8);
      shutdownApproved=true;Close();
    }catch(Exception e){Fail(e);}
  }
  void Fail(Exception error){
    shutdownApproved=true;
    if(testReport!=null){File.WriteAllText(testReport,"FALHOU: "+error,Encoding.UTF8);Environment.ExitCode=1;}
    else MessageBox.Show(this,"Não foi possível abrir a janela do editor.\n\n"+error.Message,"Etiqueta Studio",MessageBoxButtons.OK,MessageBoxIcon.Error);
    Close();
  }
  async void ClosingEditor(object sender,FormClosingEventArgs e){
    if(closing)return;e.Cancel=true;
    if(!shutdownApproved&&editor.CoreWebView2!=null){
      try{bool dirty=await editor.ExecuteScriptAsync("typeof dirty!=='undefined' && dirty")=="true";if(dirty&&MessageBox.Show(this,"Há alterações não salvas. Deseja encerrar?","Etiqueta Studio",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes)return;}catch{}
    }
    closing=true;
    try{using(var web=new WebClient()){web.Headers["Origin"]=new Uri(url).GetLeftPart(UriPartial.Authority);web.UploadString(url+"api/close","POST","");}}catch{}
    editor.Dispose();try{if(!engine.WaitForExit(2000))engine.Kill();}catch{}
    Close();
  }
}
