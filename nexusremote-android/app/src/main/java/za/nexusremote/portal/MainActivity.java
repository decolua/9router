package za.nexusremote.portal;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
  private static final String HOME="https://nexusremote-operations.vercel.app/";
  private static final int BACKGROUND=0xff0b1120;
  private static final int PANEL=0xff15243b;
  private static final int ACCENT=0xff6278ff;
  private static final int WHITE=0xffedf2ff;
  private final Handler ui=new Handler(Looper.getMainLooper());
  private WebView browser;
  private TextView status;
  private ProgressBar progress;
  private String pendingTab=null;
  private boolean pageReady=false;
  private boolean mainFrameFailed=false;
  private final java.util.concurrent.ExecutorService healthExecutor=java.util.concurrent.Executors.newSingleThreadExecutor();
  private java.util.concurrent.Future<?> healthTask;
  private int healthGeneration=0;

  @Override public void onCreate(Bundle state){
    super.onCreate(state);
    if(state!=null)pendingTab=state.getString("pendingTab");
    getWindow().setStatusBarColor(BACKGROUND);
    getWindow().setNavigationBarColor(BACKGROUND);
    LinearLayout layout=new LinearLayout(this);
    layout.setOrientation(LinearLayout.VERTICAL);
    layout.setBackgroundColor(BACKGROUND);
    setContentView(layout);
    layout.setOnApplyWindowInsetsListener((view,insets)->{
      if(android.os.Build.VERSION.SDK_INT>=30){
        android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
        view.setPadding(bars.left,bars.top,bars.right,bars.bottom);
      }else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
      return insets;
    });

    LinearLayout top=new LinearLayout(this);
    top.setOrientation(LinearLayout.VERTICAL);
    top.setPadding(dp(17),dp(15),dp(17),dp(9));
    top.setBackgroundColor(BACKGROUND);
    layout.addView(top,new LinearLayout.LayoutParams(-1,-2));

    TextView brand=new TextView(this);
    brand.setText("NEXUSREMOTE");
    brand.setTextColor(WHITE);
    brand.setTextSize(21);
    brand.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
    top.addView(brand);

    status=new TextView(this);
    status.setText("Checking hosted platform…");
    status.setTextColor(0xffa4c9e5);
    status.setTextSize(11);
    status.setMaxLines(5);
    top.addView(status);

    HorizontalScrollView scroller=new HorizontalScrollView(this);
    scroller.setHorizontalScrollBarEnabled(false);
    layout.addView(scroller,new LinearLayout.LayoutParams(-1,dp(58)));
    LinearLayout tabs=new LinearLayout(this);
    tabs.setOrientation(LinearLayout.HORIZONTAL);
    tabs.setPadding(dp(8),dp(3),dp(8),dp(3));
    scroller.addView(tabs);
    addTab(tabs,"HOME","home");
    addTab(tabs,"APPLY","apply");
    addTab(tabs,"WORKER","worker");
    addTab(tabs,"OWNER","owner");
    addUtility(tabs,"RELOAD",()->{if(browser!=null)browser.reload();checkHealth();});
    addUtility(tabs,"BROWSER",()->openExternal(HOME));

    progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);
    progress.setMax(100);
    progress.setProgressTintList(android.content.res.ColorStateList.valueOf(ACCENT));
    layout.addView(progress,new LinearLayout.LayoutParams(-1,dp(3)));

    browser=new WebView(this);
    browser.setBackgroundColor(BACKGROUND);
    browser.setVerticalScrollBarEnabled(false);
    WebSettings settings=browser.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setJavaScriptCanOpenWindowsAutomatically(false);
    settings.setSupportMultipleWindows(false);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    settings.setSaveFormData(false);
    CookieManager.getInstance().setAcceptCookie(true);
    CookieManager.getInstance().setAcceptThirdPartyCookies(browser,false);
    browser.setWebChromeClient(new WebChromeClient(){
      @Override public void onProgressChanged(WebView view,int p){progress.setProgress(p);progress.setVisibility(p>=100?View.GONE:View.VISIBLE);}
    });
    browser.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
        Uri uri=request.getUrl();
        if(PortalPolicy.isTrusted(uri.toString()))return false;
        if(request.isForMainFrame()&&"https".equalsIgnoreCase(uri.getScheme()))openExternal(uri.toString());
        return true;
      }
      @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap icon){pageReady=false;mainFrameFailed=false;}
      @Override public void onReceivedHttpError(WebView view,WebResourceRequest request,WebResourceResponse response){
        if(request.isForMainFrame()){mainFrameFailed=true;pageReady=false;status.setText("Portal returned HTTP "+response.getStatusCode()+". Tap RELOAD to retry.");}
      }
      @Override public void onPageFinished(WebView view,String url){
        pageReady=!mainFrameFailed&&PortalPolicy.isTrusted(url);
        if(pageReady&&pendingTab!=null){
          String tab=pendingTab;pendingTab=null;invokeTab(tab);
        }
      }
      @Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError err){
        if(request.isForMainFrame()){mainFrameFailed=true;pageReady=false;status.setText("Cannot reach NexusRemote. Check internet and tap RELOAD.");}
      }
    });
    layout.addView(browser,new LinearLayout.LayoutParams(-1,0,1f));
    if(state==null||browser.restoreState(state)==null)browser.loadUrl(HOME);
    checkHealth();
  }
  private void addTab(LinearLayout bar,String name,String id){
    Button b=makeButton(name,true);
    bar.addView(b,buttonParams());
    b.setOnClickListener(v->goToTab(id));
  }
  private void addUtility(LinearLayout bar,String name,Runnable run){
    Button b=makeButton(name,false);
    bar.addView(b,buttonParams());
    b.setOnClickListener(v->run.run());
  }
  private LinearLayout.LayoutParams buttonParams(){
    LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-2,dp(48));
    p.setMargins(dp(3),0,dp(3),0);
    return p;
  }
  private Button makeButton(String label,boolean primary){
    Button b=new Button(this);
    b.setText(label);
    b.setTextColor(WHITE);
    b.setAllCaps(false);
    b.setTextSize(11);
    b.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
    b.setPadding(dp(10),0,dp(10),0);
    GradientDrawable bg=new GradientDrawable();
    bg.setColor(primary?PANEL:0xff223052);
    bg.setCornerRadius(dp(10));
    bg.setStroke(dp(1),primary?0xff3a4c74:0xff526b97);
    b.setBackground(bg);
    return b;
  }
  private void goToTab(String tab){
    if(browser==null)return;
    if(!PortalPolicy.isTrusted(browser.getUrl())){
      pendingTab=tab;
      browser.loadUrl(HOME);
    }else if(!pageReady)pendingTab=tab;
    else invokeTab(tab);
  }
  private void invokeTab(String tab){
    if(browser==null||!PortalPolicy.isTrusted(browser.getUrl()))return;
    if(!("home".equals(tab)||"apply".equals(tab)||"worker".equals(tab)||"owner".equals(tab)))return;
    browser.evaluateJavascript("(function(){let b=document.querySelector('[data-tab=\\\""+tab+"\\\"]');if(b){b.click();return true}return false})()",result->{if(!"true".equals(result)&&!isDestroyed())status.setText("Portal tab unavailable. Tap RELOAD or open BROWSER.");});
  }
  private void openExternal(String uri){
    try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(uri)));}catch(ActivityNotFoundException e){status.setText("No external browser is available.");}
  }
  private void checkHealth(){
    final int generation=++healthGeneration;
    if(healthTask!=null)healthTask.cancel(true);
    healthTask=healthExecutor.submit(()->{
      String detail;
      HttpURLConnection c=null;
      try{
        c=(HttpURLConnection)new URL(HOME+"api/health").openConnection();
        c.setConnectTimeout(8500);
        c.setReadTimeout(8500);
        c.setInstanceFollowRedirects(false);
        c.setRequestProperty("Accept","application/json");
        if(c.getResponseCode()!=200)throw new Exception("Unexpected server response");
        try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
          byte[] buf=new byte[2048];int n;
          while((n=in.read(buf))!=-1){out.write(buf,0,n);if(out.size()>16000)throw new Exception("Health response too large");}
          JSONObject j=new JSONObject(out.toString("UTF-8"));
          String storage=j.opt("privateStorage") instanceof String?j.getString("privateStorage"):"unknown";
          detail="Portal reachable · Storage reported: "+storage
            +" · Stripe: "+PortalPolicy.integrationState(j.opt("stripeWebhookActive"))
            +" · WhatsApp: "+PortalPolicy.integrationState(j.opt("whatsappAlertsActive"))
            +" · Dialer: "+PortalPolicy.integrationState(j.opt("dialerConnected"))
            +" · Payouts: unknown";
        }
      }catch(Exception e){detail="Cannot verify service · check connection";}
      finally{if(c!=null)c.disconnect();}
      final String result=detail;ui.post(()->{if(!isFinishing()&&!isDestroyed()&&generation==healthGeneration&&!mainFrameFailed)status.setText(result);});
    });
  }
  private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density+.5f);}
  @Override protected void onSaveInstanceState(Bundle b){b.putString("pendingTab",pendingTab);if(browser!=null)browser.saveState(b);super.onSaveInstanceState(b);}
  @Override public void onBackPressed(){if(browser!=null&&browser.canGoBack())browser.goBack();else super.onBackPressed();}
  @Override protected void onDestroy(){++healthGeneration;healthExecutor.shutdownNow();ui.removeCallbacksAndMessages(null);if(browser!=null){browser.loadUrl("about:blank");browser.stopLoading();browser.destroy();browser=null;}super.onDestroy();}
}
