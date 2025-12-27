# Steam Purchase Timing Guide

🔗 **Live Service**: [https://sesl0ver.dev](https://sesl0ver.dev)

Steam **게임 / 패키지(Sub) / 번들(Bundle)**의 가격·할인·역대 최저가·리뷰·언어 지원 정보를 종합하여,
**구매 시점 판단에 필요한 객관적 근거만 제공하는 웹 서비스**입니다.

본 프로젝트는 구매를 유도하거나 추천, 점수화를 하지 않습니다.

---

## 📌 서비스 개요

* Steam 스토어 URL 또는 ID 입력 기반 분석
* 현재 가격과 **역대 최저가 대비 위치** 중심 정보 제공
* 할인 종료 시점, 리뷰 수치, 언어 지원, DLC 규모 등
  구매 판단에 영향을 줄 수 있는 요소를 한 화면에 정리

---

## 🔍 제공 기능

### 공통 (App / Sub / Bundle)

* 현재 가격 및 할인율
* 할인 종료 시점 (남은 시간/일수)
* 역대 최저가 및 최저가 대비 차이
* 리뷰 수 및 긍·부정 비율 요약 (수치 기반)

### App 전용

* 공식 한국어 지원 여부
* 유저 커뮤니티 한글패치 정보 (비공식)
* DLC 개수 및 DLC 총 가격 요약

---

## 🌐 데이터 출처 및 외부 API

본 서비스는 다음의 외부 API 및 공개 데이터를 사용합니다.

* **Steam Store API**

    * 게임(App), 패키지(Sub), 번들(Bundle) 정보
    * 가격 및 할인 데이터

* **Steam Web API**

    * 리뷰 관련 데이터

* **IsThereAnyDeal (ITAD) API**

    * 가격 히스토리
    * 역대 최저가 추적

데이터는 각 API 제공 범위와 정책에 따라 다를 수 있으며,
실시간 정보와 차이가 발생할 수 있습니다.

---

## ⚠️ 고지 사항

* 본 서비스는 **Steam 또는 Valve와 무관한 비공식 서비스**입니다.
* 제공되는 정보는 참고용이며, 최종 구매 판단은 사용자 본인에게 있습니다.
* 유저 한글패치 정보는 커뮤니티 기반 비공식 자료로, 보안 및 안정성을 보장하지 않습니다.
* 최종 구매 전에는 Steam 공식 상점 페이지 확인을 권장합니다.

---

## 🛠 기술 스택

* **Backend**: PHP 8.5, Slim Framework 4
* **Template Engine**: Twig
* **Frontend**: Tailwind CSS, Vanilla JavaScript
* **Cache**: Redis
* **Database**: PostgreSQL

---

## 📄 License

This project is licensed under the **MIT License**.

* Source code is freely usable, modifiable, and distributable.
* External data (Steam, IsThereAnyDeal) is subject to each provider’s terms of service.

---

© Steam Purchase Timing Guide
