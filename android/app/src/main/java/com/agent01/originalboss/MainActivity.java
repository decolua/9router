package com.agent01.originalboss;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.net.Uri;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public class MainActivity extends Activity {
  private static final String API="https://agent01-own-api.vercel.app";
  private static final String DASH="https://agent01-free-local-inference.vercel.app";
  private static final String FRONTIER="https://agent01-frontier-environment.vercel.app";
  private static final String WORK="https://agent01-work-copilot.vercel.app";
  private static final String MCP="https://agent-01-runtime.vercel.app";
  private static final int BG=0xff09111f,PANEL=0xff162337,ACCENT=0xff5073ee,WHITE=0xffedf4ff,MUTED=0xff9eb2d2;
  private LinearLayout root; private EditText task; private TextView output,status; private Button send;
  private final Handler handler=new Handler(Looper.getMainLooper());
  private interface Callback { void done(int code, String result); }
  @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().setStatusBarColor(BG);getWindow().setNavigationBarColor(BG);
    ScrollView scroll=new ScrollView(this); scroll.setFillViewport(true);scroll.setBackgroundColor(BG);
    root=new LinearLayout(this);root.setPadding(dp(18),dp(24),dp(18),dp(48));root.setOrientation(LinearLayout.VERTICAL);
    scroll.addView(root);setContentView(scroll);
    title("AGENT 01",28,WHITE,true);
    title("ORIGINAL BOSS  •  ANDROID",13,0xff88b3ff,true);
    text("Your independent AI command center. Functional online tools, local project shortcuts, secure private API-key storage.",MUTED,14);
    status=text("Runtime: checking endpoints…",0xff9ee3bc,13);
    separator();
    title("PROJECTS",18,WHITE,true);
    String[] labels={"SmartServe","OMEGA X","Share App","MDGx1","Shadowbound"};
    String[] prompts={"Design a tested offline restaurant ordering app. Include order queue, KDS, manager simulation and acceptance checks.",
      "Create an actionable MVP for AI creation using open-source models, realistic costs and tests.",
      "Review a secure file-sharing Android application, permissions, expiry, abuse protection and test cases.",
      "Create a milestone and measurable acceptance criteria for a supervised AI assistant.",
      "Plan original Shadowbound animated content production: assets, storyboard, render pipeline and QA."};
    for(int i=0;i<labels.length;i++){final int k=i;smallButton(labels[i],()->task.setText(prompts[k]));}
    separator();title("ASK AGENT 01",18,WHITE,true);
    task=new EditText(this);task.setTextColor(WHITE);task.setHintTextColor(MUTED);task.setHint("Describe the task for Agent 01…");task.setTextSize(15);task.setMinLines(4);task.setMaxLines(9);task.setGravity(Gravity.TOP);task.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_MULTI_LINE|InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);task.setPadding(dp(13),dp(13),dp(13),dp(13));task.setBackground(box(0xff101c30,0xff3c5376,14));
    root.addView(task,new LinearLayout.LayoutParams(-1,dp(130)));
    send=button("RUN AI REQUEST",()->sendTask(),ACCENT);
    output=text("Ready. Save your private API key once using the button below, then run a task. The model needs an internet connection.",WHITE,14);
    button("COPY LAST RESPONSE",()->{android.content.ClipboardManager cm=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);cm.setPrimaryClip(ClipData.newPlainText("Agent 01",output.getText()));toast("Response copied");},0xff253b5a);
    separator();title("CREDENTIALS",18,WHITE,true);
    text("Your private API key is encrypted with Android Keystore on this device. It is never bundled into the APK or uploaded anywhere other than your authenticated API call.",MUTED,13);
    button("SAVE OWN API KEY",()->showKeyDialog(),0xff28395d);
    button("FORGET API KEY",()->new AlertDialog.Builder(this).setTitle("Forget key?").setMessage("Remove the encrypted key stored on this device?").setNegativeButton("Cancel",null).setPositiveButton("Remove",(dialog,which)->{getPreferences(0).edit().remove("keycipher").remove("keyiv").apply();toast("Saved key removed");}).show(),0xff26324b);
    separator();title("CONNECTED TOOLS",18,WHITE,true);
    button("CHECK ALL API HEALTH",()->checkHealth(),0xff2a4169);
    button("FIND REAL WORK & LEADS  •  COPILOT",()->open(WORK),ACCENT);
    button("PRIVATE AI DASHBOARD  •  SIGN IN",()->open(DASH),0xff293f5e);
    button("FRONTIER GPU ENVIRONMENT",()->open(FRONTIER),0xff293f5e);
    button("YOUR PERSONAL API CONSOLE",()->open(API),0xff293f5e);
    button("MCP SERVICE DETAILS",()->open(MCP),0xff293f5e);
    button("GITHUB AUTONOMOUS WORKFLOWS",()->open("https://github.com/bernardjstander123-droid/9router/actions"),0xff293f5e);
    button("SUPERPOWERS SOURCE",()->open("https://github.com/obra/superpowers"),0xff293f5e);
    separator();text("No paid-model key is bundled. Requires internet to run actual AI inference. The Frontier control plane does not include provisioned GPUs. External tools need their own authorization; unconfigured services are not portrayed as active.",MUTED,12);
    checkHealth();
  }
  private void sendTask(){
    String prompt=task.getText().toString().trim();
    if(prompt.isEmpty()){toast("Enter a task");return;} if(prompt.length()>1500){toast("Shorten task to 1500 characters");return;}
    String key=loadKey();if(key==null||key.isEmpty()){showKeyDialog();return;}
    send.setEnabled(false);output.setText("Contacting your secured Agent 01 API…");status.setText("Running inference…");
    new Thread(()->{
      int code=0;String answer;
      try{JSONObject body=new JSONObject();body.put("model","agent01-local");JSONArray messages=new JSONArray();messages.put(new JSONObject().put("role","user").put("content",prompt));body.put("messages",messages);body.put("max_tokens",160);
        HttpURLConnection c=connection(API+"/v1/chat/completions","POST");c.setRequestProperty("Authorization","Bearer "+key);c.setRequestProperty("Content-Type","application/json");
        c.setDoOutput(true);try(OutputStream os=c.getOutputStream()){os.write(body.toString().getBytes(StandardCharsets.UTF_8));}
        code=c.getResponseCode();String raw=read(c,code);JSONObject result=new JSONObject(raw);
        if(code==200)answer=result.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content");
        else answer="API response "+code+": "+result.optJSONObject("error").optString("message","Backend not available");
        c.disconnect();
      }catch(Exception e){answer="Request failed: "+e.getClass().getSimpleName()+". Check internet, API service and key.";}
      final String text=answer;final int resultCode=code;handler.post(()->{output.setText(text);status.setText(resultCode==200?"Connected · response received":"AI service unavailable or key rejected");send.setEnabled(true);});
    }).start();
  }
  private void checkHealth(){status.setText("Checking your deployed services…");
    new Thread(()->{StringBuilder sb=new StringBuilder();
      String[][] services={{"Own API",API+"/health"},{"CPU/MCP",MCP+"/api/health"},{"Work Copilot",WORK+"/api/health"},{"Frontier control",FRONTIER+"/health"}};
      for(String[] s:services){try{HttpURLConnection c=connection(s[1],"GET");int code=c.getResponseCode();String body=read(c,code);String detail="";
          if(code==200){JSONObject j=new JSONObject(body);detail=j.optString("status",j.optString("model","Responding"));}sb.append(s[0]).append(": ").append(code==200?"ONLINE ":"CHECK REQUIRED ").append(code).append(" ").append(detail).append("\n");c.disconnect();
        }catch(Exception e){sb.append(s[0]).append(": UNREACHABLE\n");}}
      handler.post(()->status.setText(sb.toString().trim()));}).start();
  }
  private HttpURLConnection connection(String url,String method)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(12000);c.setReadTimeout(method.equals("POST")?175000:12000);c.setRequestMethod(method);c.setRequestProperty("Accept","application/json");c.setRequestProperty("User-Agent","Agent01-Android/1.0");return c;}
  private String read(HttpURLConnection c,int status)throws Exception{InputStream stream=status>=400?c.getErrorStream():c.getInputStream();if(stream==null)return "{}";try(InputStream in=stream;ByteArrayOutputStream buf=new ByteArrayOutputStream()){byte[] tmp=new byte[8192];int n;while((n=in.read(tmp))!=-1){buf.write(tmp,0,n);if(buf.size()>260000)throw new IOException("Server response too large");}return buf.toString("UTF-8");}}
  private void open(String url){startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}
  private void showKeyDialog(){EditText field=new EditText(this);field.setSingleLine(true);field.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);field.setHint("Paste private Agent 01 API key");field.setPadding(dp(22),dp(14),dp(22),dp(14));
    new AlertDialog.Builder(this).setTitle("Your private API key").setMessage("Paste your own API key generated in Vercel. The app stores it encrypted in Android Keystore.").setView(field).setNegativeButton("Cancel",null).setPositiveButton("Save",(d,w)->{String key=field.getText().toString().trim();if(!key.matches("[A-Za-z0-9_-]{32,200}")){toast("Invalid key format");return;}try{storeKey(key);toast("Key encrypted and saved");}catch(Exception e){toast("Key encryption failed");}}).show();}
  private SecretKey secretKey()throws Exception{KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);if(ks.containsAlias("a01_private_token"))return (SecretKey)ks.getKey("a01_private_token",null);
    KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder("a01_private_token",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());return g.generateKey();}
  private void storeKey(String key)throws Exception{Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,secretKey());
    String c=Base64.encodeToString(cipher.doFinal(key.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
    String iv=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP);
    getPreferences(0).edit().putString("keycipher",c).putString("keyiv",iv).apply();}
  private String loadKey(){try{String s=getPreferences(0).getString("keycipher",null),iv=getPreferences(0).getString("keyiv",null);if(s==null||iv==null)return null;Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,secretKey(),new GCMParameterSpec(128,Base64.decode(iv,Base64.NO_WRAP)));return new String(cipher.doFinal(Base64.decode(s,Base64.NO_WRAP)),StandardCharsets.UTF_8);}catch(Exception e){return null;}}
  private void separator(){View line=new View(this);line.setBackgroundColor(0xff2c405b);LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,dp(1));p.setMargins(0,dp(18),0,dp(18));root.addView(line,p);}
  private TextView text(String value,int color,int size){TextView t=new TextView(this);t.setText(value);t.setTextColor(color);t.setTextSize(size);t.setPadding(0,dp(6),0,dp(6));root.addView(t,new LinearLayout.LayoutParams(-1,-2));return t;}
  private TextView title(String value,int size,int color,boolean bold){TextView t=text(value,color,size);if(bold)t.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return t;}
  private void smallButton(String label,Runnable r){button("◉  "+label+"  ·  Load task",r,0xff1c2d48);}
  private Button button(String label,Runnable action,int bg){Button b=new Button(this);b.setAllCaps(false);b.setText(label);b.setTextColor(WHITE);b.setTextSize(14);b.setBackground(box(bg,0xff38547a,12));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(49));lp.setMargins(0,dp(6),0,dp(4));root.addView(b,lp);b.setOnClickListener(v->action.run());return b;}
  private GradientDrawable box(int color,int border,int radius){GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(radius));d.setStroke(dp(1),border);return d;}
  private int dp(int n){return (int)(n*getResources().getDisplayMetrics().density+.5f);}
  private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_SHORT).show();}
}