package com.examtrack.app;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSArray;

import org.json.JSONObject;
import org.opencv.android.Utils;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.MatOfPoint;
import org.opencv.core.MatOfPoint2f;
import org.opencv.imgproc.Moments;
import org.opencv.core.Point;
import org.opencv.core.Rect;
import org.opencv.core.RotatedRect;
import org.opencv.core.Scalar;
import org.opencv.core.Size;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.imgproc.Imgproc;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@CapacitorPlugin(name = "NativeScan")
public class NativeScanPlugin extends Plugin {

  private static final int WARP_W = 800;
  private static final int WARP_H = 1131;

  private static class Bubble {
    Point c;
    float r;
    double circularity;
    Bubble(Point c, float r, double circularity) {
      this.c = c;
      this.r = r;
      this.circularity = circularity;
    }
  }

  private static String stripDataUrlPrefix(String s) {
    if (s == null) return null;
    int idx = s.indexOf(",");
    if (idx >= 0) return s.substring(idx + 1);
    return s;
  }

  private static Mat decodeBase64ToMat(String base64) throws Exception {
    String raw = stripDataUrlPrefix(base64);
    if (raw == null || raw.isEmpty()) throw new Exception("imageBase64 empty");
    byte[] bytes = Base64.decode(raw, Base64.DEFAULT);

    // Downsample large camera images to avoid OOM / force-stop.
    // The scan pipeline warps to 800x1131 anyway, so huge inputs bring no benefit.
    final int maxDim = 2000;
    BitmapFactory.Options bounds = new BitmapFactory.Options();
    bounds.inJustDecodeBounds = true;
    BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);

    int inSampleSize = 1;
    int w = Math.max(1, bounds.outWidth);
    int h = Math.max(1, bounds.outHeight);
    while ((w / inSampleSize) > maxDim || (h / inSampleSize) > maxDim) {
      inSampleSize *= 2;
    }

    BitmapFactory.Options opts = new BitmapFactory.Options();
    opts.inSampleSize = Math.max(1, inSampleSize);
    opts.inPreferredConfig = Bitmap.Config.ARGB_8888;

    Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
    if (bmp == null) throw new Exception("Failed to decode image bytes");

    Mat rgba = new Mat();
    try {
      Utils.bitmapToMat(bmp, rgba);
      return rgba;
    } finally {
      try { bmp.recycle(); } catch (Exception ignored) {}
    }
  }

  private static Point contourCenter(MatOfPoint c) {
    Moments m = Imgproc.moments(c);
    if (Math.abs(m.get_m00()) < 1e-6) return new Point(0, 0);
    return new Point(m.get_m10() / m.get_m00(), m.get_m01() / m.get_m00());
  }

  private static List<Point> orderQuad(List<Point> pts) {
    List<Point> out = new ArrayList<>(pts);
    if (out.size() != 4) return out;
    Point tl = null, tr = null, br = null, bl = null;
    double bestSumMin = Double.POSITIVE_INFINITY;
    double bestSumMax = Double.NEGATIVE_INFINITY;
    double bestDiffMin = Double.POSITIVE_INFINITY;
    double bestDiffMax = Double.NEGATIVE_INFINITY;
    for (Point p : out) {
      double sum = p.x + p.y;
      double diff = p.x - p.y;
      if (sum < bestSumMin) { bestSumMin = sum; tl = p; }
      if (sum > bestSumMax) { bestSumMax = sum; br = p; }
      if (diff > bestDiffMax) { bestDiffMax = diff; tr = p; }
      if (diff < bestDiffMin) { bestDiffMin = diff; bl = p; }
    }
    List<Point> ordered = new ArrayList<>();
    ordered.add(tl);
    ordered.add(tr);
    ordered.add(br);
    ordered.add(bl);
    return ordered;
  }

  private static Mat warpByCornerSquares(Mat rgba) throws Exception {
    Mat gray = new Mat();
    Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY);
    Imgproc.GaussianBlur(gray, gray, new Size(5, 5), 0);

    Mat bin = new Mat();
    Imgproc.threshold(gray, bin, 0, 255, Imgproc.THRESH_BINARY_INV + Imgproc.THRESH_OTSU);

    List<MatOfPoint> contours = new ArrayList<>();
    Mat hierarchy = new Mat();
    Imgproc.findContours(bin, contours, hierarchy, Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE);

    int w = rgba.cols();
    int h = rgba.rows();
    double imgArea = (double) w * (double) h;

    List<Point> markerCenters = new ArrayList<>();
    for (MatOfPoint c : contours) {
      double area = Imgproc.contourArea(c);
      if (area < imgArea * 0.0005 || area > imgArea * 0.05) continue;
      Rect r = Imgproc.boundingRect(c);
      double ar = (double) r.width / (double) Math.max(1, r.height);
      if (ar < 0.75 || ar > 1.33) continue;

      MatOfPoint2f c2f = new MatOfPoint2f(c.toArray());
      double peri = Imgproc.arcLength(c2f, true);
      if (peri <= 0) continue;
      MatOfPoint2f approx = new MatOfPoint2f();
      Imgproc.approxPolyDP(c2f, approx, 0.04 * peri, true);
      if (approx.total() != 4) continue;

      Point center = contourCenter(c);
      markerCenters.add(center);
    }

    if (markerCenters.size() < 4) throw new Exception("Corner markers not found");

    // Keep the 4 extreme centers (closest to each corner) by scoring.
    Point tl = null, tr = null, br = null, bl = null;
    double bestTL = Double.POSITIVE_INFINITY;
    double bestTR = Double.POSITIVE_INFINITY;
    double bestBR = Double.POSITIVE_INFINITY;
    double bestBL = Double.POSITIVE_INFINITY;
    for (Point p : markerCenters) {
      double sTL = p.x + p.y;
      double sBR = (w - p.x) + (h - p.y);
      double sTR = (w - p.x) + p.y;
      double sBL = p.x + (h - p.y);
      if (sTL < bestTL) { bestTL = sTL; tl = p; }
      if (sTR < bestTR) { bestTR = sTR; tr = p; }
      if (sBR < bestBR) { bestBR = sBR; br = p; }
      if (sBL < bestBL) { bestBL = sBL; bl = p; }
    }
    if (tl == null || tr == null || br == null || bl == null) throw new Exception("Corner marker selection failed");

    MatOfPoint2f srcPts = new MatOfPoint2f(tl, tr, br, bl);
    MatOfPoint2f dstPts = new MatOfPoint2f(
      new Point(0, 0),
      new Point(WARP_W - 1, 0),
      new Point(WARP_W - 1, WARP_H - 1),
      new Point(0, WARP_H - 1)
    );

    Mat H = Imgproc.getPerspectiveTransform(srcPts, dstPts);
    Mat warped = new Mat();
    Imgproc.warpPerspective(rgba, warped, H, new Size(WARP_W, WARP_H));
    return warped;
  }

  private static List<Bubble> detectBubbles(Mat warpedRgba) {
    Mat gray = new Mat();
    Imgproc.cvtColor(warpedRgba, gray, Imgproc.COLOR_RGBA2GRAY);
    Imgproc.GaussianBlur(gray, gray, new Size(5, 5), 0);

    Mat bin = new Mat();
    Imgproc.adaptiveThreshold(gray, bin, 255, Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C, Imgproc.THRESH_BINARY_INV, 35, 8);

    Mat kernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, new Size(3, 3));
    Imgproc.morphologyEx(bin, bin, Imgproc.MORPH_OPEN, kernel);

    List<MatOfPoint> contours = new ArrayList<>();
    Imgproc.findContours(bin, contours, new Mat(), Imgproc.RETR_EXTERNAL, Imgproc.CHAIN_APPROX_SIMPLE);

    List<Bubble> bubbles = new ArrayList<>();
    double imgArea = (double) warpedRgba.cols() * (double) warpedRgba.rows();
    double minArea = imgArea * 0.00004;   // tuned for 800x1131
    double maxArea = imgArea * 0.00120;

    for (MatOfPoint c : contours) {
      double area = Imgproc.contourArea(c);
      if (area < minArea || area > maxArea) continue;

      Rect r = Imgproc.boundingRect(c);
      if (r.y < 180) continue; // ignore header
      if (r.height < 10 || r.width < 10) continue;
      double ar = (double) r.width / (double) Math.max(1, r.height);
      if (ar < 0.6 || ar > 1.4) continue;

      MatOfPoint2f c2f = new MatOfPoint2f(c.toArray());
      double peri = Imgproc.arcLength(c2f, true);
      if (peri <= 0) continue;
      double circ = (4.0 * Math.PI * area) / (peri * peri);
      if (circ < 0.55) continue;

      Point center = contourCenter(c);
      float rad = (float) (0.5 * (r.width + r.height) * 0.25);
      bubbles.add(new Bubble(center, rad, circ));
    }

    return bubbles;
  }

  private static double meanGrayInAnnulus(Mat gray, Point c, int rInner, int rOuter) {
    int w = gray.cols();
    int h = gray.rows();
    int ro = Math.max(1, rOuter);
    int ri = Math.max(0, Math.min(rInner, ro - 1));

    int x0 = Math.max(0, (int) Math.floor(c.x - ro));
    int y0 = Math.max(0, (int) Math.floor(c.y - ro));
    int x1 = Math.min(w - 1, (int) Math.ceil(c.x + ro));
    int y1 = Math.min(h - 1, (int) Math.ceil(c.y + ro));

    int rw = Math.max(1, x1 - x0 + 1);
    int rh = Math.max(1, y1 - y0 + 1);
    Rect roi = new Rect(x0, y0, rw, rh);

    Mat sub = null;
    Mat mask = null;
    Mat innerMask = null;
    try {
      sub = gray.submat(roi);
      mask = Mat.zeros(sub.size(), CvType.CV_8UC1);
      innerMask = Mat.zeros(sub.size(), CvType.CV_8UC1);

      Point cc = new Point(c.x - x0, c.y - y0);
      Imgproc.circle(mask, cc, ro, new Scalar(255), -1);
      if (ri > 0) {
        Imgproc.circle(innerMask, cc, ri, new Scalar(255), -1);
        Core.subtract(mask, innerMask, mask);
      }

      Scalar m = Core.mean(sub, mask);
      return m.val[0];
    } finally {
      try { if (innerMask != null) innerMask.release(); } catch (Exception ignored) {}
      try { if (mask != null) mask.release(); } catch (Exception ignored) {}
      try { if (sub != null) sub.release(); } catch (Exception ignored) {}
    }
  }

  private static double bubbleFillScore(Mat gray, Point c, int r) {
    // Similar to the JS scanner: use an inner annulus to avoid printed glyphs in the center,
    // and a background annulus outside the bubble to estimate local paper brightness.
    int rr = Math.max(8, r);
    int inner0 = Math.max(2, (int) Math.round(rr * 0.22));
    int inner1 = Math.max(inner0 + 1, (int) Math.round(rr * 0.55));
    int bg0 = Math.max(inner1 + 2, (int) Math.round(rr * 0.95));
    int bg1 = Math.max(bg0 + 2, (int) Math.round(rr * 1.55));

    double innerMean = meanGrayInAnnulus(gray, c, inner0, inner1);
    double bgMean = meanGrayInAnnulus(gray, c, bg0, bg1);
    return bgMean - innerMean;
  }

  private static String matToBase64Jpeg(Mat rgba) {
    Mat bgr = new Mat();
    Imgproc.cvtColor(rgba, bgr, Imgproc.COLOR_RGBA2BGR);
    MatOfPoint2f unused = new MatOfPoint2f();
    org.opencv.core.MatOfByte mob = new org.opencv.core.MatOfByte();
    Imgcodecs.imencode(".jpg", bgr, mob);
    byte[] bytes = mob.toArray();
    bgr.release();
    mob.release();
    return Base64.encodeToString(bytes, Base64.NO_WRAP);
  }

  private static Map<Integer, List<Bubble>> groupIntoQuestionRows(List<Bubble> bubbles, int maxItems) {
    // Sort by y then x.
    Collections.sort(bubbles, new Comparator<Bubble>() {
      @Override
      public int compare(Bubble a, Bubble b) {
        int cy = Double.compare(a.c.y, b.c.y);
        if (cy != 0) return cy;
        return Double.compare(a.c.x, b.c.x);
      }
    });

    // Cluster into rows by y proximity.
    double yTol = 18.0;
    List<List<Bubble>> rows = new ArrayList<>();
    for (Bubble b : bubbles) {
      boolean placed = false;
      for (List<Bubble> row : rows) {
        double y = row.get(0).c.y;
        if (Math.abs(b.c.y - y) <= yTol) {
          row.add(b);
          placed = true;
          break;
        }
      }
      if (!placed) {
        List<Bubble> row = new ArrayList<>();
        row.add(b);
        rows.add(row);
      }
    }

    // Sort bubbles within each row by x, and keep rows that look like question rows.
    List<List<Bubble>> goodRows = new ArrayList<>();
    for (List<Bubble> row : rows) {
      Collections.sort(row, new Comparator<Bubble>() {
        @Override
        public int compare(Bubble a, Bubble b) {
          return Double.compare(a.c.x, b.c.x);
        }
      });
      if (row.size() < 4) continue;
      // If there are more than 4 candidates (noise), take the best 4 by circularity.
      if (row.size() > 4) {
        Collections.sort(row, new Comparator<Bubble>() {
          @Override
          public int compare(Bubble a, Bubble b) {
            return -Double.compare(a.circularity, b.circularity);
          }
        });
        row = row.subList(0, 4);
        Collections.sort(row, new Comparator<Bubble>() {
          @Override
          public int compare(Bubble a, Bubble b) {
            return Double.compare(a.c.x, b.c.x);
          }
        });
      }
      goodRows.add(new ArrayList<>(row));
    }

    // Sort rows left-to-right by their mean x to support multi-column layouts, then by y.
    Collections.sort(goodRows, new Comparator<List<Bubble>>() {
      @Override
      public int compare(List<Bubble> ra, List<Bubble> rb) {
        double ax = 0, bx = 0;
        for (Bubble b : ra) ax += b.c.x;
        for (Bubble b : rb) bx += b.c.x;
        ax /= Math.max(1, ra.size());
        bx /= Math.max(1, rb.size());
        int cx = Double.compare(ax, bx);
        if (Math.abs(ax - bx) > 120) return cx;
        return Double.compare(ra.get(0).c.y, rb.get(0).c.y);
      }
    });

    Map<Integer, List<Bubble>> qMap = new HashMap<>();
    int q = 1;
    for (List<Bubble> row : goodRows) {
      if (q > maxItems) break;
      // Ensure left-to-right option order.
      Collections.sort(row, new Comparator<Bubble>() {
        @Override
        public int compare(Bubble a, Bubble b) {
          return Double.compare(a.c.x, b.c.x);
        }
      });
      qMap.put(q, row);
      q++;
    }
    return qMap;
  }

  @PluginMethod
  public void ping(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("ok", true);
    ret.put("message", "NativeScan plugin ready");
    call.resolve(ret);
  }

  @PluginMethod
  public void scanSheet(PluginCall call) {
    JSObject ret = new JSObject();
    Mat rgba = null;
    Mat warped = null;
    Mat gray = null;
    try {
      String imageBase64 = call.getString("imageBase64");
      Integer maxItemsObj = call.getInt("maxItems");
      int maxItems = maxItemsObj != null ? Math.max(1, maxItemsObj) : 50;

      // Optional template coordinates produced by the Answer Sheet Generator (already in warped sheet space).
      // If provided, we skip contour-based bubble detection and sample these exact positions.
      JSArray templateArr = null;
      try {
        templateArr = call.getArray("template");
      } catch (Exception ignored) {
        templateArr = null;
      }

      JSObject answerKeyObj = call.getObject("answerKey");
      Map<Integer, String> answerKey = new HashMap<>();
      if (answerKeyObj != null) {
        java.util.Iterator<String> it = answerKeyObj.keys();
        while (it.hasNext()) {
          String k = it.next();
          try {
            int q = Integer.parseInt(k);
            String v = String.valueOf(answerKeyObj.get(k)).trim().toUpperCase(Locale.ROOT);
            if (v.equals("A") || v.equals("B") || v.equals("C") || v.equals("D")) {
              answerKey.put(q, v);
            }
          } catch (Exception ignored) {
          }
        }
      }

      rgba = decodeBase64ToMat(imageBase64);
      warped = warpByCornerSquares(rgba);

      // Build qRows either from template (preferred) or from detected bubbles (fallback).
      Map<Integer, List<Bubble>> qRows = new HashMap<>();
      if (templateArr != null && templateArr.length() > 0) {
        for (int i = 0; i < templateArr.length(); i++) {
          if (qRows.size() >= maxItems) break;
          try {
            Object it = templateArr.get(i);
            if (!(it instanceof JSObject)) continue;
            JSObject qObj = (JSObject) it;
            int qNum = 0;
            try { qNum = Integer.parseInt(String.valueOf(qObj.get("question"))); } catch (Exception ignored) {}
            if (qNum <= 0 || qNum > maxItems) continue;

            Object optObjRaw = qObj.get("options");
            if (!(optObjRaw instanceof JSObject)) continue;
            JSObject optObj = (JSObject) optObjRaw;

            List<Bubble> row = new ArrayList<>();
            String[] opts = new String[]{"A", "B", "C", "D"};
            for (String o : opts) {
              Object coordRaw = optObj.get(o);
              if (!(coordRaw instanceof JSObject)) { row.clear(); break; }
              JSObject coord = (JSObject) coordRaw;
              double cx = Double.parseDouble(String.valueOf(coord.get("cx")));
              double cy = Double.parseDouble(String.valueOf(coord.get("cy")));
              double rr = Double.parseDouble(String.valueOf(coord.get("radius")));
              row.add(new Bubble(new Point(cx, cy), (float) rr, 1.0));
            }

            if (row.size() == 4) {
              qRows.put(qNum, row);
            }
          } catch (Exception ignored) {
          }
        }
      }

      if (qRows.isEmpty()) {
        List<Bubble> detected = detectBubbles(warped);
        qRows = groupIntoQuestionRows(detected, maxItems);
      }

      gray = new Mat();
      Imgproc.cvtColor(warped, gray, Imgproc.COLOR_RGBA2GRAY);

      JSObject answers = new JSObject();
      int score = 0;
      int correctCount = 0;
      int incorrectCount = 0;
      int blankCount = 0;
      int total = 0;

      List<Double> bestScores = new ArrayList<>();
      Map<Integer, double[]> perQScores = new HashMap<>();
      for (int q = 1; q <= maxItems; q++) {
        List<Bubble> row = qRows.get(q);
        if (row == null || row.size() < 4) {
          perQScores.put(q, new double[]{0, 0, 0, 0});
          bestScores.add(0.0);
          continue;
        }
        double[] fills = new double[4];
        double base = Double.POSITIVE_INFINITY;
        for (int i = 0; i < 4; i++) {
          Bubble b = row.get(i);
          // Template radius is already in sheet pixels; detected radius is approximate.
          // Use a conservative radius for sampling to avoid including the printed outline.
          int r = Math.max(8, (int) Math.round(b.r));
          fills[i] = bubbleFillScore(gray, b.c, r);
          if (fills[i] < base) base = fills[i];
        }
        for (int i = 0; i < 4; i++) fills[i] = fills[i] - base;
        perQScores.put(q, fills);
        double best = Math.max(Math.max(fills[0], fills[1]), Math.max(fills[2], fills[3]));
        bestScores.add(best);
      }

      Collections.sort(bestScores);
      double strong = bestScores.isEmpty() ? 0 : bestScores.get((int) Math.floor(0.90 * (bestScores.size() - 1)));
      // "60% shaded" rule: require mark strength to be at least 60% of strong marks for this sheet.
      double minFill = Math.max(12, Math.min(30, strong * 0.60));
      double minSep = Math.max(5, Math.min(12, minFill * 0.35));

      for (int q = 1; q <= maxItems; q++) {
        double[] fills = perQScores.get(q);
        int bestIdx = 0;
        int secondIdx = 1;
        for (int i = 0; i < 4; i++) {
          if (fills[i] > fills[bestIdx]) {
            secondIdx = bestIdx;
            bestIdx = i;
          } else if (i != bestIdx && fills[i] > fills[secondIdx]) {
            secondIdx = i;
          }
        }

        String selected = null;
        if (fills[bestIdx] >= minFill && (fills[bestIdx] - fills[secondIdx]) >= minSep) {
          selected = new String[]{"A", "B", "C", "D"}[bestIdx];
        }
        if (selected == null) {
          answers.put(String.valueOf(q), JSONObject.NULL);
        } else {
          answers.put(String.valueOf(q), selected);
        }

        String correct = answerKey.get(q);
        if (correct != null) {
          total++;
          if (selected == null) {
            blankCount++;
          } else if (selected.equals(correct)) {
            score++;
            correctCount++;
          } else {
            incorrectCount++;
          }
        }

        // Overlay circle on warped image if bubble locations exist.
        List<Bubble> row = qRows.get(q);
        if (row != null && row.size() >= 4) {
          for (int i = 0; i < 4; i++) {
            Bubble b = row.get(i);
            String opt = new String[]{"A", "B", "C", "D"}[i];
            boolean isMarked = selected != null && selected.equals(opt);
            boolean isCorrect = correct != null && opt.equals(correct);
            if (isMarked) {
              Scalar color = isCorrect
                ? new Scalar(0, 200, 0, 255)
                : new Scalar(220, 0, 0, 255);
              int rr = Math.max(10, (int) Math.round(b.r * 4.0));
              Imgproc.circle(warped, b.c, rr, color, 3);
            }
          }
        }
      }

      String overlayBase64 = matToBase64Jpeg(warped);

      ret.put("ok", true);
      ret.put("answers", answers);
      ret.put("score", score);
      ret.put("total", total);
      ret.put("correctCount", correctCount);
      ret.put("incorrectCount", incorrectCount);
      ret.put("blankCount", blankCount);
      ret.put("overlayImageBase64", overlayBase64);
      call.resolve(ret);
    } catch (Exception e) {
      ret.put("ok", false);
      ret.put("error", String.valueOf(e.getMessage()));
      call.resolve(ret);
    } finally {
      try { if (gray != null) gray.release(); } catch (Exception ignored) {}
      try { if (warped != null) warped.release(); } catch (Exception ignored) {}
      try { if (rgba != null) rgba.release(); } catch (Exception ignored) {}
    }
  }
}
