package com.sceneforge.studio;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;
import android.widget.Toast;
import android.widget.FrameLayout;
import android.widget.Button;
import android.view.Gravity;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
  private static final String APP_URL="https://sceneforge-studio.hatchable.site";
  private static final String APP_HOST="sceneforge-studio.hatchable.site";
  private static final int PICK_FILE=311;
  private static final int ASK_CAMERA=312;
  private final ExecutorService io=Executors.newSingleThreadExecutor();
  private WebView web;
  private ValueCallback<Uri[]> fileCallback;
  private PermissionRequest cameraRequest;
  private volatile Uri latestExportUri;
  private volatile String latestExportMime;

  @Override public void onCreate(Bundle savedInstanceState){
    super.onCreate(savedInstanceState);
    getWindow().setStatusBarColor(0xff090b16);
    getWindow().setNavigationBarColor(0xff090b16);
    web=new WebView(this);
    WebSettings settings=web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(true);
    settings.setAllowFileAccessFromFileURLs(false);
    settings.setAllowUniversalAccessFromFileURLs(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setMediaPlaybackRequiresUserGesture(true);
    CookieManager.getInstance().setAcceptCookie(true);
    web.setBackgroundColor(0xff080a16);
    // Native export endpoint is injected only into the owner-controlled HTTPS origin.
    // Other frames, including third-party embeds, cannot message the native side.
    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      WebViewCompat.addWebMessageListener(web, "SceneForgeNative",
          Collections.singleton(APP_URL), (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
        if (!isMainFrame || !isTrustedHost(sourceOrigin) || !isCurrentTrustedPage()) return;
        String payload = message.getData();
        if (payload == null || payload.length() > 42000100) return;
        try {
          JSONObject data = new JSONObject(payload);
          saveExport(data.optString("data", ""), data.optString("filename", "SceneForge-export"));
        } catch (Exception ignored) {
          show("Invalid export message.");
        }
      });
    } else {
      show("Update Android System WebView to enable native exports.");
    }
    web.setWebViewClient(new WebViewClient(){
      @Override public void onPageFinished(WebView view, String url) {
        if (isTrustedHost(Uri.parse(url)) && isCurrentTrustedPage()
            && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
          // Compat shim preserves the site's SceneForgeSave.save(dataUrl,filename) contract.
          // It is created only in the verified main frame. The native endpoint rejects subframes.
          String shim = "(function(){window.SceneForgeSave={save:function(data,filename){"
              + "if(typeof data==='string'&&data.length<=42000000){"
              + "window.SceneForgeNative.postMessage(JSON.stringify({data:data,filename:filename||'SceneForge-export'}));"
              + "}}};})();";
          view.evaluateJavascript(shim, null);
        }
      }
      @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
        Uri uri = Uri.parse(url);
        if (!isTrustedNavigation(uri)) {
          view.stopLoading();
          if ("https".equalsIgnoreCase(uri.getScheme())) openExternalDesign(url);
        }
      }
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
        if(!request.isForMainFrame())return false;
        Uri uri=request.getUrl();
        if(isTrustedNavigation(uri))return false;
        if(!"https".equalsIgnoreCase(uri.getScheme()))return true;
        try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}
        catch(Exception e){show("No browser available for external link.");}
        return true;
      }
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
        if(fileCallback!=null)fileCallback.onReceiveValue(null);
        fileCallback=callback;
        try{startActivityForResult(params.createIntent(),PICK_FILE);return true;}
        catch(Exception e){fileCallback=null;show("Cannot open file picker.");return false;}
      }
      @Override public void onPermissionRequest(PermissionRequest request){
        runOnUiThread(()->{
          Uri origin=request.getOrigin();
          if(!"https".equalsIgnoreCase(origin.getScheme())||!APP_HOST.equalsIgnoreCase(origin.getHost())){
            request.deny();return;
          }
          boolean video=false;
          for(String type:request.getResources())if(PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(type))video=true;
          if(!video){request.deny();return;}
          if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED){
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
          }else{
            cameraRequest=request;
            requestPermissions(new String[]{Manifest.permission.CAMERA},ASK_CAMERA);
          }
        });
      }
      @Override public void onPermissionRequestCanceled(PermissionRequest req){
        if(req==cameraRequest)cameraRequest=null;
      }
    });
    web.setDownloadListener((url,userAgent,contentDisposition,mimeType,length)->{
      if(url.startsWith("blob:"))downloadBlob(url,mimeType);
      else if(url.startsWith("https://")){
        try{
          DownloadManager.Request request=new DownloadManager.Request(Uri.parse(url));
          request.setMimeType(mimeType);
          request.addRequestHeader("User-Agent",userAgent);
          String cookie=CookieManager.getInstance().getCookie(url);
          if(cookie!=null)request.addRequestHeader("Cookie",cookie);
          request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
          request.setDestinationInExternalFilesDir(this,Environment.DIRECTORY_DOWNLOADS,URLUtil.guessFileName(url,contentDisposition,mimeType));
          ((DownloadManager)getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
          show("Download requested.");
        }catch(Exception e){show("Download failed.");}
      }else show("Unsupported download source.");
    });
    FrameLayout root = new FrameLayout(this);
    root.addView(web, new FrameLayout.LayoutParams(-1, -1));
    Button design = new Button(this);
    design.setText("Design tools");
    design.setTextAllCaps(false);
    design.setContentDescription("Open Figma and Canva design tools");
    design.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xff363f80));
    design.setTextColor(0xffffffff);
    FrameLayout.LayoutParams toolsLayout = new FrameLayout.LayoutParams(
        (int)(122 * getResources().getDisplayMetrics().density),
        (int)(48 * getResources().getDisplayMetrics().density));
    toolsLayout.gravity = Gravity.BOTTOM | Gravity.END;
    toolsLayout.setMargins(0, 0, 12, 18);
    root.addView(design, toolsLayout);
    design.setOnClickListener(v -> openDesignTools());
    setContentView(root);
    web.loadUrl(APP_URL);
  }

  private void openDesignTools() {
    String[] actions = {
      "Open Figma online", "Open Canva online",
      "SceneForge Canva UI style guide", "SceneForge Canva VFX overlay",
      "Ansvar security and compliance", "Share latest SceneForge export"
    };
    new AlertDialog.Builder(this)
      .setTitle("SceneForge • Design tools")
      .setItems(actions, (dialog, which) -> {
        if (which == 0) openExternalDesign("https://www.figma.com/files/");
        else if (which == 1) openExternalDesign("https://www.canva.com/");
        else if (which == 2) openExternalDesign("https://www.canva.com/d/vyGKmbd0UzgT-LK");
        else if (which == 3) openExternalDesign("https://www.canva.com/d/igpGFVAkFKn8xrU");
        else if (which == 4) openExternalDesign("https://ansvar.eu/docs/quickstart");
        else shareLatestExport();
      })
      .show();
  }

  private void openExternalDesign(String url) {
    // External websites must never load inside the privileged export-bridge WebView.
    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
    catch (Exception e) { show("No browser available to open design tool."); }
  }

  private void shareLatestExport() {
    Uri uri = latestExportUri;
    String mime = latestExportMime;
    if (uri == null || mime == null) {
      show("Export PNG or video first, then open Design tools to share.");
      return;
    }
    Intent send = new Intent(Intent.ACTION_SEND);
    send.setType(mime);
    send.putExtra(Intent.EXTRA_STREAM, uri);
    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    try { startActivity(Intent.createChooser(send, "Share SceneForge export")); }
    catch (Exception e) { show("Share failed. Open Downloads/SceneForge."); }
  }

  private boolean isTrustedHost(Uri uri) {
    if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
    if (!APP_HOST.equalsIgnoreCase(uri.getHost())) return false;
    if (uri.getUserInfo() != null) return false;
    return uri.getPort() == -1 || uri.getPort() == 443;
  }
  private boolean isCurrentTrustedPage() {
    return web != null && web.getUrl() != null && isTrustedHost(Uri.parse(web.getUrl()));
  }
  private boolean isTrustedNavigation(Uri uri) {
    if (uri == null || !"https".equalsIgnoreCase(uri.getScheme())) return false;
    if (uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return false;
    String host = uri.getHost();
    if (host == null) return false;
    return APP_HOST.equalsIgnoreCase(host) || "hatchable.com".equalsIgnoreCase(host)
        || host.toLowerCase(java.util.Locale.ROOT).endsWith(".hatchable.com");
  }

  private void downloadBlob(String url,String mimeType){
    if(!isCurrentTrustedPage())return;
    final String js="(async()=>{try{const r=await fetch("+JSONObject.quote(url)+");"+
      "const b=await r.blob();if(b.size>30000000)throw Error('File is too large');"+
      "const reader=new FileReader();reader.onloadend=()=>window.SceneForgeSave.save(String(reader.result),"+
      "b.type==='image/png'?'SceneForge-frame.png':b.type==='video/mp4'?'SceneForge-scene.mp4':'SceneForge-scene.webm');"+
      "reader.readAsDataURL(b);}catch(e){console.error(e)}})();";
    runOnUiThread(()->web.evaluateJavascript(js,null));
  }

  private void saveExport(String dataUrl,String filename) {
      if (!isCurrentTrustedPage()) return;
      if(dataUrl==null||dataUrl.length()>42000000)return;
      int comma=dataUrl.indexOf(',');
      if(comma<10)return;
      String header=dataUrl.substring(0,comma);
      String mime;
      if(header.equals("data:image/png;base64"))mime="image/png";
      else if(header.equals("data:video/webm;base64"))mime="video/webm";
      else if(header.equals("data:video/mp4;base64"))mime="video/mp4";
      else return;
      final String safeName=(filename==null?"SceneForge-export":filename).replaceAll("[^a-zA-Z0-9._-]","_");
      io.execute(()->{
        try{
          byte[] bytes=Base64.decode(dataUrl.substring(comma+1),Base64.DEFAULT);
          if(bytes.length==0||bytes.length>30000000){show("Export too large or empty.");return;}
          if(Build.VERSION.SDK_INT>=29){
            ContentValues vals=new ContentValues();
            vals.put(MediaStore.Downloads.DISPLAY_NAME,safeName);
            vals.put(MediaStore.Downloads.MIME_TYPE,mime);
            vals.put(MediaStore.Downloads.RELATIVE_PATH,Environment.DIRECTORY_DOWNLOADS+"/SceneForge");
            vals.put(MediaStore.Downloads.IS_PENDING,1);
            Uri dest=getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,vals);
            if(dest==null)throw new IllegalStateException("Cannot open Downloads");
            try(OutputStream out=getContentResolver().openOutputStream(dest)){
              if(out==null)throw new IllegalStateException("Cannot write export");
              out.write(bytes);
            }
            vals.clear();vals.put(MediaStore.Downloads.IS_PENDING,0);
            getContentResolver().update(dest,vals,null,null);
            latestExportUri = dest;
            latestExportMime = mime;
          }else{
            File dir=new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS),"SceneForge");
            if(!dir.exists()&&!dir.mkdirs())throw new IllegalStateException("Cannot create directory");
            try(OutputStream out=new FileOutputStream(new File(dir,safeName))){out.write(bytes);}
          }
          show("SceneForge export saved. Check Downloads/SceneForge.");
        }catch(Exception e){show("Export save failed. Try opening in Chrome.");}
      });
    }
  private void show(String msg){runOnUiThread(()->Toast.makeText(this,msg,Toast.LENGTH_LONG).show());}
  @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] grants){
    super.onRequestPermissionsResult(requestCode,permissions,grants);
    if(requestCode==ASK_CAMERA&&cameraRequest!=null){
      final PermissionRequest r=cameraRequest;cameraRequest=null;
      if(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)r.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
      else r.deny();
    }
  }
  @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
    super.onActivityResult(requestCode,resultCode,data);
    if(requestCode==PICK_FILE&&fileCallback!=null){
      fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));
      fileCallback=null;
    }
  }
  @Override public void onBackPressed(){
    if(web!=null&&web.canGoBack())web.goBack();
    else super.onBackPressed();
  }
  @Override protected void onDestroy(){
    if(cameraRequest!=null){cameraRequest.deny();cameraRequest=null;}
    if(web!=null){web.destroy();web=null;}
    io.shutdown();super.onDestroy();
  }
}
