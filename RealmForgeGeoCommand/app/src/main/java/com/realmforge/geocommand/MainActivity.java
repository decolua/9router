package com.realmforge.geocommand;
import android.Manifest;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.content.pm.PackageManager;
import androidx.webkit.WebViewAssetLoader;
public class MainActivity extends Activity {
 private static final int LOCATION_REQUEST=17;
 private WebView webView;
 private GeolocationPermissions.Callback pendingCallback;
 private String pendingOrigin;
 @Override public void onCreate(Bundle state) {
  super.onCreate(state); webView=new WebView(this); setContentView(webView);
  webView.getSettings().setJavaScriptEnabled(true);
  webView.getSettings().setDomStorageEnabled(true);
  webView.getSettings().setGeolocationEnabled(true);
  final WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
  webView.setWebViewClient(new WebViewClient(){
   @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,android.webkit.WebResourceRequest request){return loader.shouldInterceptRequest(request.getUrl());}
  });
  webView.setWebChromeClient(new WebChromeClient(){
   @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback callback){
    if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED){callback.invoke(origin,true,false);}
    else{pendingCallback=callback;pendingOrigin=origin;requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},LOCATION_REQUEST);}
   }
  });
  webView.loadUrl("https://appassets.androidplatform.net/assets/index.html");
 }
 @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){
  super.onRequestPermissionsResult(code,permissions,grants);
  if(code==LOCATION_REQUEST&&pendingCallback!=null){boolean ok=false;for(int grant:grants)if(grant==PackageManager.PERMISSION_GRANTED)ok=true;pendingCallback.invoke(pendingOrigin,ok,false);pendingCallback=null;pendingOrigin=null;}
 }
 @Override public void onBackPressed(){if(webView.canGoBack())webView.goBack();else super.onBackPressed();}
}