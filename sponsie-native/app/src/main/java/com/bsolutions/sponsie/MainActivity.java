package com.bsolutions.sponsie;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.util.Base64;
import java.security.SecureRandom;
import java.security.MessageDigest;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Network;
import android.net.Uri;
import java.net.URL;
import java.net.URI;
import java.net.HttpURLConnection;
import java.net.URLEncoder;
import java.io.ByteArrayOutputStream;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.Locale;

public final class MainActivity extends Activity {
    private WebView web;
    private Store store;
    private SharedPreferences authPrefs;
    private volatile boolean signedIn = false;
    private int failedLogins = 0;
    private long holdUntil = 0L;
    private final Object jobsLock = new Object();
    private boolean jobsFetching = false;
    private long lastJobsAttempt = 0L;
    private static final String JOBS_ENDPOINT = "https://remotive.com/api/remote-jobs?limit=100";
    private static final long JOB_REFRESH_PERIOD_MS = 6L * 60 * 60 * 1000;
    private static final String[] TYPES = {"website", "proposal", "research", "content", "data"};
    private static boolean allowed(String type) { for (String t: TYPES) if (t.equals(type)) return true; return false; }
    private static String safe(String s, int max) { if (s == null) return ""; String v = s.trim(); return v.length() > max ? v.substring(0, max) : v; }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xff090d24);
        getWindow().setNavigationBarColor(0xff090d24);
        store = new Store();
        authPrefs = getSharedPreferences("sponsie_local_owner", MODE_PRIVATE);
        web = new WebView(this);
        WebSettings cfg = web.getSettings();
        cfg.setJavaScriptEnabled(true);
        WebView.setWebContentsDebuggingEnabled(false);
        cfg.setDomStorageEnabled(false);
        cfg.setAllowFileAccess(false);
        cfg.setAllowContentAccess(false);
        cfg.setJavaScriptCanOpenWindowsAutomatically(false);
        cfg.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return true; }
        });
        web.addJavascriptInterface(new Bridge(), "Sponsie");
        setContentView(web);
        try(InputStream input = getAssets().open("index.html")) {
            String html = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            String jpeg = "";
            try (InputStream hero = getAssets().open("colony-hero.jpg")) {
                jpeg = Base64.encodeToString(hero.readAllBytes(), Base64.NO_WRAP);
            }
            html = html.replace("__SPONSIE_HERO_DATA__", "data:image/jpeg;base64," + jpeg);
            web.loadDataWithBaseURL("https://sponsie.invalid/", html, "text/html", "UTF-8", null);
        } catch(Exception e) {
            web.loadData("<h2>Unable to open dashboard</h2>", "text/html", "UTF-8");
        }
    }
    @Override public void onDestroy(){ if(web!=null){web.removeJavascriptInterface("Sponsie");web.destroy();} if(store!=null)store.close(); super.onDestroy(); }
    private JSONObject netState() throws Exception {
        boolean connected = false;
        try {
            ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            Network active = manager == null ? null : manager.getActiveNetwork();
            NetworkCapabilities caps = active == null ? null : manager.getNetworkCapabilities(active);
            connected = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        } catch (Exception ignored) { }
        return new JSONObject().put("online",connected)
                .put("source","Remotive public API")
                .put("lastFetched",getSharedPreferences("sponsie_remote_jobs", MODE_PRIVATE).getLong("fetched",0L));
    }
    private String networkStatus() {
        try {return netState().toString();}
        catch(Exception e){return "{\"online\":false}";}
    }
    // This does not send any business credentials or user-entered briefs to the provider.
    private String cachedJobs() {
        if (!signedIn) return "{\"ok\":false,\"error\":\"Owner login required\"}";
        try {
            SharedPreferences prefs = getSharedPreferences("sponsie_remote_jobs",MODE_PRIVATE);
            JSONObject cache = new JSONObject(prefs.getString("cache","{\"jobs\":[]}"));
            cache.put("ok",true).put("cached",true).put("fetched",prefs.getLong("fetched",0L));
            return cache.toString();
        } catch(Exception e){return "{\"ok\":false,\"error\":\"Unable to load cached listings\"}";}
    }
    private void publishJobs(final JSONObject data) {
        final String json = JSONObject.quote(data.toString());
        runOnUiThread(() -> {
            if(web != null && signedIn)
                web.evaluateJavascript("window.onSponsieJobs && window.onSponsieJobs(JSON.parse("+json+"))",null);
        });
    }
    private void refreshJobs(){
        if(!signedIn)return;
        synchronized(jobsLock){
            if(jobsFetching){return;}
            SharedPreferences prefs=getSharedPreferences("sponsie_remote_jobs",MODE_PRIVATE);
            long now=System.currentTimeMillis();
            long last=prefs.getLong("fetched",0L);
            long attempt=prefs.getLong("attempt",0L);
            if(now-last < JOB_REFRESH_PERIOD_MS || now-attempt < 120000L){
                try {JSONObject data=new JSONObject(cachedJobs());data.put("message",now-last < JOB_REFRESH_PERIOD_MS?"Using stored listings (refresh limited to 4 per day).":"Please retry in a few minutes.");publishJobs(data);}catch(Exception e){}return;
            }
            jobsFetching=true;
            prefs.edit().putLong("attempt",now).apply();
        }
        new Thread(() -> {
            JSONObject result=new JSONObject();
            HttpURLConnection conn=null;
            try {
                if(!netState().optBoolean("online",false))throw new Exception("No validated internet connection. Offline drafts remain available.");
                URL endpoint = new URL(JOBS_ENDPOINT);
                if(!endpoint.getProtocol().equals("https") || !endpoint.getHost().equals("remotive.com"))throw new SecurityException("Untrusted jobs API host");
                conn=(HttpURLConnection)endpoint.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(7000);conn.setReadTimeout(10000);
                conn.setRequestProperty("Accept","application/json");
                conn.setRequestProperty("User-Agent","SponsieAutopilot/0.3 (Remotive attribution; Android)");
                int status=conn.getResponseCode();
                if(status!=200)throw new Exception("Job provider returned HTTP "+status);
                String type=conn.getContentType();
                if(type==null || !type.toLowerCase(Locale.ROOT).contains("json"))throw new Exception("Unexpected response format");
                ByteArrayOutputStream out=new ByteArrayOutputStream();
                try(InputStream input=conn.getInputStream()){
                    byte[] buf=new byte[4096];int n;int total=0;
                    while((n=input.read(buf))!=-1){total+=n;if(total>3*1024*1024)throw new Exception("Job feed too large");out.write(buf,0,n);}
                }
                JSONObject body=new JSONObject(out.toString("UTF-8"));
                JSONArray jobs=body.optJSONArray("jobs");
                if(jobs==null)throw new Exception("Job provider response has no jobs list");
                JSONArray safeJobs=new JSONArray();
                int max=Math.min(500,jobs.length());
                for(int i=0;i<max && safeJobs.length()<15;i++){
                    JSONObject j=jobs.optJSONObject(i);if(j==null)continue;
                    String geo=safe(j.optString("candidate_required_location",""),200);
                    String g=geo.toLowerCase(Locale.ROOT);
                    // Only keep explicitly broad or South-Africa-inclusive locations.
                    boolean plausible = g.equals("worldwide") || g.equals("global") || g.equals("anywhere") || g.equals("remote - anywhere")
                        || g.contains("south africa") || g.equals("africa") || g.contains("africa (all)") || g.equals("emea");
                    if(!plausible)continue;
                    String url=safe(j.optString("url",""),550);
                    if(!isTrustedListingUrl(url))continue;
                    JSONObject item=new JSONObject();
                    item.put("title",safe(j.optString("title",""),140));
                    item.put("company",safe(j.optString("company_name",""),110));
                    item.put("location",geo);
                    item.put("date",safe(j.optString("publication_date",""),55));
                    item.put("type",safe(j.optString("job_type",""),50));
                    item.put("salary",safe(j.optString("salary",""),90));
                    item.put("url",url);
                    safeJobs.put(item);
                }
                result.put("ok",true).put("cached",false).put("jobs",safeJobs)
                    .put("message","Location tags are preliminary. Check every employer's South Africa eligibility and terms before applying.")
                    .put("source","Remotive");
                getSharedPreferences("sponsie_remote_jobs",MODE_PRIVATE).edit().putString("cache",result.toString())
                    .putLong("fetched",System.currentTimeMillis()).apply();
            } catch(Exception e) {
                try {result=new JSONObject(cachedJobs());result.put("error",safe(e.getMessage(),160));}catch(Exception ignored){}
            } finally {
                if(conn!=null)conn.disconnect();
                synchronized(jobsLock){jobsFetching=false;}
            }
            publishJobs(result);
        },"sponsie-jobs-network").start();
    }
    private static boolean isTrustedListingUrl(String address) {
        try {
            URI uri=new URI(address);
            String host=uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme()) && ("remotive.com".equalsIgnoreCase(host) || "www.remotive.com".equalsIgnoreCase(host))
                && uri.getUserInfo()==null && uri.getPort()==-1;
        }catch(Exception e){return false;}
    }
    private void openListing(String address) {
        if(!signedIn || !isTrustedListingUrl(address))return;
        runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
            .setTitle("Open Remotive listing?")
            .setMessage("You're leaving Sponsie to review this job. South Africa eligibility, employer identity and current status must be confirmed on the listing. No application will be submitted automatically.")
            .setNegativeButton("Cancel",null)
            .setPositiveButton("Open browser",(d,w) -> {
                try {startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(address)));}
                catch(Exception e){new AlertDialog.Builder(MainActivity.this).setMessage("No browser could open this link.").setPositiveButton("OK",null).show();}
            }).show());
    }
    private static String digest(char[] pass, byte[] salt) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(pass, salt, 130000, 256);
        try {
            byte[] b = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            return Base64.encodeToString(b, Base64.NO_WRAP);
        } finally { spec.clearPassword(); }
    }
    private synchronized String authenticationState(){
        try { return new JSONObject().put("registered", authPrefs.contains("hash"))
            .put("loggedIn", signedIn)
            .put("email", signedIn ? authPrefs.getString("email", "") : "").toString(); }
        catch(Exception e) {return "{\"registered\":false,\"loggedIn\":false}";}
    }
    private static String authResult(boolean ok, String message) {
        try {return new JSONObject().put("ok",ok).put("message",message).toString();}
        catch(Exception e){return "{\"ok\":false}";}
    }
    private synchronized String registerOwner(String email, String password, String confirmation) {
        if(authPrefs.contains("hash")) return authResult(false, "An owner account already exists on this device.");
        String mail = safe(email, 180).toLowerCase(Locale.ROOT);
        if(!mail.contains("@") || mail.startsWith("@") || !mail.substring(mail.indexOf('@')).contains("."))
            return authResult(false, "Enter a valid email label.");
        if(password == null || password.length() < 8 || password.length() > 128)
            return authResult(false,"Use a password of 8 to 128 characters.");
        if(!password.equals(confirmation)) return authResult(false,"Passwords do not match.");
        try {
            byte[] salt = new byte[20]; new SecureRandom().nextBytes(salt);
            String hash = digest(password.toCharArray(), salt);
            boolean saved = authPrefs.edit().putString("email",mail)
                .putString("salt",Base64.encodeToString(salt,Base64.NO_WRAP))
                .putString("hash",hash).commit();
            if(!saved) return authResult(false,"Unable to save local account.");
            signedIn = true; failedLogins = 0; holdUntil = 0;
            return authResult(true,"Owner account created locally. No cloud account was registered.");
        }catch(Exception e){return authResult(false,"Unable to set up secure owner password.");}
    }
    private synchronized String loginOwner(String email, String password) {
        if(!authPrefs.contains("hash")) return authResult(false,"Create your local owner account first.");
        if(SystemClock.elapsedRealtime() < holdUntil) return authResult(false,"Too many attempts. Try again shortly.");
        try {
            String mail=safe(email,180).toLowerCase(Locale.ROOT);
            byte[] salt=Base64.decode(authPrefs.getString("salt",""),Base64.NO_WRAP);
            String expected=authPrefs.getString("hash","");
            String found=digest((password==null?"":password).toCharArray(), salt);
            boolean match=MessageDigest.isEqual(found.getBytes(StandardCharsets.UTF_8),expected.getBytes(StandardCharsets.UTF_8))
                && mail.equals(authPrefs.getString("email", ""));
            if(!match){ failedLogins++; if(failedLogins>=5){failedLogins=0;holdUntil=SystemClock.elapsedRealtime()+30000;}return authResult(false,"Incorrect email or password.");}
            signedIn=true; failedLogins=0; holdUntil=0;
            return authResult(true,"Unlocked your local workforce dashboard.");
        } catch(Exception e){return authResult(false,"Unable to authenticate locally.");}
    }
    private synchronized void logoutOwner(){signedIn=false;}
    @Override protected void onStop() {
        signedIn=false;
        if(web!=null)web.evaluateJavascript("window.lockSponsie && window.lockSponsie()",null);
        super.onStop();
    }
    private final class Store extends SQLiteOpenHelper {
        Store(){super(MainActivity.this,"sponsie-native.db",null,1);}
        @Override public void onCreate(SQLiteDatabase d){
            d.execSQL("CREATE TABLE tasks(id TEXT PRIMARY KEY,type TEXT NOT NULL,title TEXT NOT NULL,brief TEXT NOT NULL,output TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL)");
            d.execSQL("CREATE TABLE activity(id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,created INTEGER NOT NULL)");
        }
        @Override public void onUpgrade(SQLiteDatabase d,int oldV,int newV) { }
        synchronized void record(SQLiteDatabase d,String event){ ContentValues row=new ContentValues();row.put("event",event);row.put("created",System.currentTimeMillis());d.insertOrThrow("activity",null,row); }
        synchronized String create(String type,String title,String brief) throws Exception {
            if(!allowed(type))throw new IllegalArgumentException("Unsupported assignment type");
            title=safe(title,100); brief=safe(brief,5000);
            if(title.isEmpty()||brief.isEmpty())throw new IllegalArgumentException("Title and brief are required");
            String id=UUID.randomUUID().toString(); String output=generate(type,title,brief);
            SQLiteDatabase d=getWritableDatabase();d.beginTransaction();try{
                ContentValues row=new ContentValues();row.put("id",id);row.put("type",type);row.put("title",title);row.put("brief",brief);row.put("output",output);row.put("status","REVIEW_REQUIRED");row.put("created",System.currentTimeMillis());
                d.insertOrThrow("tasks",null,row);record(d,"Created "+type+" draft: "+title);d.setTransactionSuccessful();
            }finally{d.endTransaction();}return id;
        }
        synchronized String list() throws Exception {
            JSONArray out=new JSONArray();
            try(Cursor c=getReadableDatabase().rawQuery("SELECT id,type,title,brief,status,created FROM tasks ORDER BY created DESC LIMIT 200",null)){
                while(c.moveToNext()){JSONObject o=new JSONObject();o.put("id",c.getString(0));o.put("type",c.getString(1));o.put("title",c.getString(2));o.put("brief",c.getString(3));o.put("status",c.getString(4));o.put("created",c.getLong(5));out.put(o);}
            } return out.toString();
        }
        synchronized String output(String id){try(Cursor c=getReadableDatabase().rawQuery("SELECT output FROM tasks WHERE id=?",new String[]{id})){return c.moveToFirst()?c.getString(0):"";}}
        synchronized String taskTitle(String id){try(Cursor c=getReadableDatabase().rawQuery("SELECT title FROM tasks WHERE id=?",new String[]{id})){return c.moveToFirst()?c.getString(0):"";}}
        synchronized boolean decide(String id,String decision){
            if(!decision.equals("READY_FOR_MANUAL_DELIVERY")&&!decision.equals("REJECTED"))return false;
            SQLiteDatabase d=getWritableDatabase();d.beginTransaction();try{
                ContentValues cv=new ContentValues();cv.put("status",decision);
                int n=d.update("tasks",cv,"id=? AND status='REVIEW_REQUIRED'",new String[]{id});
                if(n==1){record(d,"Owner marked task "+id.substring(0,8)+" as "+decision);d.setTransactionSuccessful();return true;}
                return false;
            }finally{d.endTransaction();}
        }
        synchronized String logs()throws Exception{
            JSONArray out=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT event,created FROM activity ORDER BY id DESC LIMIT 50",null)){
                while(c.moveToNext()){JSONObject o=new JSONObject();o.put("event",c.getString(0));o.put("created",c.getLong(1));out.put(o);}
            }return out.toString();
        }
    }
    private final class Bridge {
        @JavascriptInterface public String networkStatus(){return signedIn?MainActivity.this.networkStatus():"{\"online\":false}";}
        @JavascriptInterface public void refreshJobs(){if(signedIn)MainActivity.this.refreshJobs();}
        @JavascriptInterface public String cachedJobs(){return MainActivity.this.cachedJobs();}
        @JavascriptInterface public void openListing(String url){MainActivity.this.openListing(url);}
        @JavascriptInterface public String authState(){return authenticationState();}
        @JavascriptInterface public String register(String email, String password, String confirm){return registerOwner(email,password,confirm);}
        @JavascriptInterface public String login(String email, String password){return loginOwner(email,password);}
        @JavascriptInterface public void logout(){logoutOwner();runOnUiThread(()-> web.evaluateJavascript("window.lockSponsie && window.lockSponsie()",null));}
        @JavascriptInterface public String list(){if(!signedIn)return "[]";try{return store.list();}catch(Exception e){return "[]";}}
        @JavascriptInterface public String logs(){if(!signedIn)return "[]";try{return store.logs();}catch(Exception e){return "[]";}}
        @JavascriptInterface public String create(String type,String title,String brief){
            if(!signedIn)return authResult(false,"Sign in to create assignments.");
            try{return new JSONObject().put("ok",true).put("id",store.create(type,title,brief)).toString();}
            catch(Exception e){try{return new JSONObject().put("ok",false).put("error",safe(e.getMessage(),160)).toString();}catch(Exception ignored){return "{\"ok\":false}";}}
        }
        @JavascriptInterface public String output(String id){return signedIn?store.output(safe(id,80)):"";}
        @JavascriptInterface public void decide(String id, boolean approve){
            if(!signedIn)return;
            final String task=safe(id,80);final String title=store.taskTitle(task);if(title.isEmpty())return;
            runOnUiThread(()->new AlertDialog.Builder(MainActivity.this)
                .setTitle(approve?"Approve this draft?":"Reject this draft?")
                .setMessage("“"+title+"”\n\nApproval marks the output ready for your manual delivery. It does not contact the client or send anything.")
                .setNegativeButton("Cancel",(d,w)->{})
                .setPositiveButton(approve?"Approve":"Reject",(d,w)->{
                    boolean ok=store.decide(task,approve?"READY_FOR_MANUAL_DELIVERY":"REJECTED");
                    web.evaluateJavascript("window.refreshSponsie && window.refreshSponsie()",null);
                    if(!ok)new AlertDialog.Builder(MainActivity.this).setMessage("This item was already reviewed.").setPositiveButton("OK",null).show();
                }).show());
        }
        @JavascriptInterface public void share(String id){
            if(!signedIn)return;
            String value=store.output(safe(id,80));if(value.isEmpty())return;
            runOnUiThread(()->{
                Intent i=new Intent(Intent.ACTION_SEND);i.setType("text/plain");i.putExtra(Intent.EXTRA_SUBJECT,store.taskTitle(id));i.putExtra(Intent.EXTRA_TEXT,value);
                startActivity(Intent.createChooser(i,"Export a draft manually"));
            });
        }
    }
    private static String esc(String s){return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;");}
    private static String generate(String type,String title,String brief){
        String t=esc(title),b=esc(brief);
        if(type.equals("website")){
            return "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>"+t+"</title><style>body{margin:0;background:#10162d;color:#fff;font:16px system-ui}header{background:linear-gradient(125deg,#582bc8,#1592ca);padding:64px 24px;text-align:center}h1{font-size:clamp(32px,6vw,62px)}main{max-width:800px;margin:45px auto;padding:20px}.cta{display:inline-block;border:1px solid #fff;border-radius:12px;padding:12px 20px}footer{color:#aab;text-align:center;padding:30px}</style><header><h1>"+t+"</h1><p>Client brief-based landing page draft</p><span class=\"cta\">Contact us</span></header><main><h2>About this project</h2><p>"+b.replace("\n","<br>")+"</p><h2>Next steps</h2><p>Replace placeholder details with client-approved copy before publishing. Contact links intentionally omitted.</p></main><footer>Original draft · Review before publishing</footer></html>";
        }
        if(type.equals("proposal")) return "PROPOSAL DRAFT — NOT SENT\n\nProject: "+title+"\n\nClient requirements:\n"+brief+"\n\nProposed approach:\n1. Confirm scope and acceptance criteria with the client.\n2. Produce a first deliverable.\n3. Review changes together.\n4. Package approved files.\n\nPricing: To be agreed with the client.\nDelivery timing: To be confirmed.\n\nNo commitment has been made.";
        if(type.equals("research")) return "RESEARCH BRIEF — SOURCE VERIFICATION REQUIRED\n\nTopic: "+title+"\nResearch request: "+brief+"\n\nEvidence ledger:\n- Source URL: [add credible URL]\n- Publisher and publication date: [verify]\n- Key finding: [verify]\n- Confidence: UNVERIFIED\n\nNo facts or citations have been invented.";
        if(type.equals("content")) return "ORIGINAL CONTENT DRAFT — REVIEW BEFORE POSTING\n\nCampaign: "+title+"\nSource brief: "+brief+"\n\nPost 1: Introducing our work and the problem we help solve.\nPost 2: What to expect from a well-scoped project.\nPost 3: Behind the scenes: research, creation and review.\n\nReplace generic wording with client-approved facts and brand voice. No posts sent.";
        return "DATA PROCESSING PLAN — NO DATASET PROVIDED\n\nAssignment: "+title+"\nBrief: "+brief+"\n\nSteps:\n1. Obtain client-authorized CSV.\n2. Preserve untouched original.\n3. Profile headers, missing values and duplicate keys.\n4. Produce cleaned dataset and an exceptions report.\n5. Verify results before delivery.\n\nNo rows were processed; attach a dataset through an approved workflow to perform real cleaning.";
    }
}
