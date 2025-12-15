package at.ac.uibk.dps.cirrina.execution.object.expression;

import com.google.common.base.CharMatcher;

import java.util.*;

public final class Utility {

  public static byte[] genRandPayload(int[] sizes) {
    final var rand = new Random();

    final var randomIndex = rand.nextInt(sizes.length);
    final var selectedSize = sizes[randomIndex];

    return new byte[selectedSize];
  }

  public static <T extends Number> String appendToMap(
          String map,
          String key,
          T value) {

    Map<String, List<String>> newMap = (Objects.equals(map, "{:}")) ? new HashMap<>() : convertStringToMap(map);
    newMap.computeIfAbsent(key, k -> new ArrayList<>());
    List<String> newList = newMap.get(key);
    newList.add(value.toString());
    newMap.put(key, newList);
    return convertMapToString(newMap);
  }
  public static <T extends Number> String replaceInMap(String map, String key, T value){
    Map<String, List<String>> newMap = (Objects.equals(map, "{:}")) ? new HashMap<>() : convertStringToMap(map);
    newMap.computeIfAbsent(key, k -> new ArrayList<>());
    newMap.put(key, List.of(value.toString()));
    return convertMapToString(newMap);
  }

  public static Map<String, List<String>> convertStringToMap(String data) {
    Map<String, List<String>> map = new HashMap<>();

    data = data.trim();
    if (data.startsWith("{") && data.endsWith("}")) {
      data = data.substring(1, data.length() - 1);
    }
    if (data.isEmpty()) return map;

    int bracketLevel = 0;
    StringBuilder token = new StringBuilder();
    List<String> pairs = new ArrayList<>();

    for (char c : data.toCharArray()) {
      if (c == '[') bracketLevel++;
      if (c == ']') bracketLevel--;
      if (c == ',' && bracketLevel == 0) {
        pairs.add(token.toString().trim());
        token.setLength(0);
      } else {
        token.append(c);
      }
    }
    if (!token.isEmpty()) {
      pairs.add(token.toString().trim());
    }

    for (String pair : pairs) {
      String[] keyValue = pair.split("=", 2);
      if (keyValue.length != 2) continue;
      String key = CharMatcher.anyOf("[]{} ").removeFrom(keyValue[0]);
      String value = CharMatcher.anyOf("[]{} ").removeFrom(keyValue[1]);
      map.put(key, new ArrayList<>(Collections.singletonList(value)));
    }

    return map;
  }

  public static String convertMapToString(Map<String, ?> map) {
    StringBuilder mapAsString = new StringBuilder("{");
    for (String key : map.keySet()) {
      mapAsString.append(key + "=" + map.get(key) + ", ");
    }
    mapAsString.delete(mapAsString.length()-2, mapAsString.length()).append("}");
    return mapAsString.toString();
  }

  public static long now() {
    return System.currentTimeMillis() / 1000L;
  }

  public static <T extends Number> Boolean notIn(ArrayList<Number> list, T valueOne, T valueTwo) {
    return !(list.contains(valueOne) || list.contains(valueTwo));
  }

  public static <T extends Number> Boolean in(ArrayList<Number> list, T valueOne, T valueTwo) {
    return (list.contains(valueOne) && list.contains(valueTwo));
  }

  public static <T extends Number> ArrayList<Number> addToList(ArrayList<Number> list, T valueOne, T valueTwo) {
    list.add(valueOne);
    list.add(valueTwo);
    return list;
  }

  public static <T extends Number> ArrayList<Number> removeFromList(ArrayList<Number> list, T valueOne, T valueTwo) {
    list.remove(valueOne);
    list.remove(valueTwo);
    return list;
  }
}
