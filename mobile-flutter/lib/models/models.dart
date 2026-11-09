// Modelos de dominio fuertemente tipados para PichangaBook Arequipa.

class UserProfile {
  final String id;
  final String fullName;
  final String role;
  final String phoneMasked;
  final int trustScore;
  final int bookingsCount;
  final int ownedComplexesCount;

  const UserProfile({
    required this.id,
    required this.fullName,
    required this.role,
    required this.phoneMasked,
    required this.trustScore,
    this.bookingsCount = 0,
    this.ownedComplexesCount = 0,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: (json['id'] ?? '').toString(),
      fullName: (json['fullName'] ?? 'Usuario PichangaBook').toString(),
      role: (json['role'] ?? 'ORGANIZER').toString(),
      phoneMasked: (json['phoneMasked'] ?? '+51 9•• ••• •••').toString(),
      trustScore: (json['trustScore'] as num?)?.toInt() ?? 90,
      bookingsCount: (json['bookingsCount'] as num?)?.toInt() ?? 0,
      ownedComplexesCount: (json['ownedComplexesCount'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'fullName': fullName,
        'role': role,
        'phoneMasked': phoneMasked,
        'trustScore': trustScore,
        'bookingsCount': bookingsCount,
        'ownedComplexesCount': ownedComplexesCount,
      };
}

class SportsComplex {
  final String id;
  final String name;
  final String ruc;
  final String businessName;
  final String verificationStatus;
  final String districtCode;
  final String districtName;
  final String address;
  final double lat;
  final double lng;
  final List<String> photos;
  final List<String> amenities;
  final double rating;
  final int reviewsCount;
  final int courtsCount;
  final int minPriceCents;
  final int maxPriceCents;
  final double? distanceKm;

  const SportsComplex({
    required this.id,
    required this.name,
    required this.ruc,
    required this.businessName,
    required this.verificationStatus,
    required this.districtCode,
    required this.districtName,
    required this.address,
    required this.lat,
    required this.lng,
    required this.photos,
    required this.amenities,
    required this.rating,
    required this.reviewsCount,
    required this.courtsCount,
    required this.minPriceCents,
    required this.maxPriceCents,
    this.distanceKm,
  });

  factory SportsComplex.fromJson(Map<String, dynamic> json) {
    return SportsComplex(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      ruc: (json['ruc'] ?? '').toString(),
      businessName: (json['businessName'] ?? '').toString(),
      verificationStatus: (json['verificationStatus'] ?? 'VERIFIED').toString(),
      districtCode: (json['districtCode'] ?? '').toString(),
      districtName: (json['districtName'] ?? '').toString(),
      address: (json['address'] ?? '').toString(),
      lat: (json['lat'] as num?)?.toDouble() ?? -16.3989,
      lng: (json['lng'] as num?)?.toDouble() ?? -71.5350,
      photos: (json['photos'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      amenities: (json['amenities'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      rating: double.tryParse((json['rating'] ?? '4.8').toString()) ?? 4.8,
      reviewsCount: (json['reviewsCount'] as num?)?.toInt() ?? 0,
      courtsCount: (json['courtsCount'] as num?)?.toInt() ?? 1,
      minPriceCents: (json['minPriceCents'] as num?)?.toInt() ?? 6000,
      maxPriceCents: (json['maxPriceCents'] as num?)?.toInt() ?? 9000,
      distanceKm: (json['distanceKm'] as num?)?.toDouble(),
    );
  }

  String get minPriceSoles => (minPriceCents / 100).toStringAsFixed(0);
}

class CourtSummary {
  final String id;
  final String name;
  final int playersPerSide;
  final int priceCents;
  final int pricePeakCents;
  final int openHour;
  final int closeHour;

  const CourtSummary({
    required this.id,
    required this.name,
    required this.playersPerSide,
    required this.priceCents,
    required this.pricePeakCents,
    required this.openHour,
    required this.closeHour,
  });

  factory CourtSummary.fromJson(Map<String, dynamic> json) {
    return CourtSummary(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      playersPerSide: (json['playersPerSide'] as num?)?.toInt() ?? 6,
      priceCents: (json['priceCents'] as num?)?.toInt() ?? 6000,
      pricePeakCents: (json['pricePeakCents'] as num?)?.toInt() ?? 9000,
      openHour: (json['openHour'] as num?)?.toInt() ?? 7,
      closeHour: (json['closeHour'] as num?)?.toInt() ?? 23,
    );
  }
}

class TimeSlot {
  final String courtId;
  final String date;
  final int hour;
  final String label;
  final String status; // FREE | HELD | CONFIRMED | BLOCKED
  final int priceCents;
  final String? bookingId;
  final String? channel;
  final String? customerName;
  final String? notes;
  final int? splitPaid;
  final int? splitTotal;
  final String? shareToken;
  final String? holdExpiresAt;

  const TimeSlot({
    required this.courtId,
    required this.date,
    required this.hour,
    required this.label,
    required this.status,
    required this.priceCents,
    this.bookingId,
    this.channel,
    this.customerName,
    this.notes,
    this.splitPaid,
    this.splitTotal,
    this.shareToken,
    this.holdExpiresAt,
  });

  factory TimeSlot.fromJson(Map<String, dynamic> json) {
    final split = json['split'] as Map<String, dynamic>?;
    return TimeSlot(
      courtId: (json['courtId'] ?? '').toString(),
      date: (json['date'] ?? '').toString(),
      hour: (json['hour'] as num?)?.toInt() ?? 18,
      label: (json['label'] ?? '').toString(),
      status: (json['status'] ?? 'FREE').toString(),
      priceCents: (json['priceCents'] as num?)?.toInt() ?? 6000,
      bookingId: json['bookingId']?.toString(),
      channel: json['channel']?.toString(),
      customerName: json['customerName']?.toString(),
      notes: json['notes']?.toString(),
      splitPaid: (split?['paid'] as num?)?.toInt(),
      splitTotal: (split?['total'] as num?)?.toInt(),
      shareToken: split?['shareToken']?.toString(),
      holdExpiresAt: json['holdExpiresAt']?.toString(),
    );
  }

  String get priceSoles => (priceCents / 100).toStringAsFixed(0);
}

class ReviewItem {
  final String id;
  final int rating;
  final String comment;
  final String authorName;
  final String createdAt;

  const ReviewItem({
    required this.id,
    required this.rating,
    required this.comment,
    required this.authorName,
    required this.createdAt,
  });

  factory ReviewItem.fromJson(Map<String, dynamic> json) {
    return ReviewItem(
      id: (json['id'] ?? '').toString(),
      rating: (json['rating'] as num?)?.toInt() ?? 5,
      comment: (json['comment'] ?? '').toString(),
      authorName: (json['authorName'] ?? 'Jugador').toString(),
      createdAt: (json['createdAt'] ?? '').toString(),
    );
  }
}

class BookingRecord {
  final String id;
  final String courtId;
  final String courtName;
  final String complexId;
  final String complexName;
  final String districtName;
  final String status;
  final String channel;
  final String? paymentMode;
  final String date;
  final int hour;
  final String hourLabel;
  final int totalCents;
  final int depositCents;
  final String? shareToken;
  final int? paidSlots;
  final int? totalSlots;

  const BookingRecord({
    required this.id,
    required this.courtId,
    required this.courtName,
    required this.complexId,
    required this.complexName,
    required this.districtName,
    required this.status,
    required this.channel,
    required this.date,
    required this.hour,
    required this.hourLabel,
    required this.totalCents,
    required this.depositCents,
    this.paymentMode,
    this.shareToken,
    this.paidSlots,
    this.totalSlots,
  });

  factory BookingRecord.fromJson(Map<String, dynamic> json) {
    return BookingRecord(
      id: (json['id'] ?? '').toString(),
      courtId: (json['courtId'] ?? '').toString(),
      courtName: (json['courtName'] ?? '').toString(),
      complexId: (json['complexId'] ?? '').toString(),
      complexName: (json['complexName'] ?? '').toString(),
      districtName: (json['districtName'] ?? '').toString(),
      status: (json['status'] ?? 'CONFIRMED').toString(),
      channel: (json['channel'] ?? 'APP').toString(),
      paymentMode: json['paymentMode']?.toString(),
      date: (json['date'] ?? '').toString(),
      hour: (json['hour'] as num?)?.toInt() ?? 20,
      hourLabel: (json['hourLabel'] ?? '20:00').toString(),
      totalCents: (json['totalCents'] as num?)?.toInt() ?? 9000,
      depositCents: (json['depositCents'] as num?)?.toInt() ?? 4500,
      shareToken: json['shareToken']?.toString(),
      paidSlots: (json['paidSlots'] as num?)?.toInt(),
      totalSlots: (json['totalSlots'] as num?)?.toInt(),
    );
  }
}

class PaymentShareItem {
  final String id;
  final String payerName;
  final String method;
  final String providerChargeId;
  final int amountCents;
  final String paidAt;

  const PaymentShareItem({
    required this.id,
    required this.payerName,
    required this.method,
    required this.providerChargeId,
    required this.amountCents,
    required this.paidAt,
  });

  factory PaymentShareItem.fromJson(Map<String, dynamic> json) {
    return PaymentShareItem(
      id: (json['id'] ?? '').toString(),
      payerName: (json['payerName'] ?? 'Jugador').toString(),
      method: (json['method'] ?? 'YAPE').toString(),
      providerChargeId: (json['providerChargeId'] ?? '').toString(),
      amountCents: (json['amountCents'] as num?)?.toInt() ?? 1500,
      paidAt: (json['paidAt'] ?? '').toString(),
    );
  }
}

class SplitPaymentDetail {
  final String id;
  final String bookingId;
  final String shareToken;
  final int totalSlots;
  final int paidSlots;
  final int remainingSlots;
  final int amountPerSlotCents;
  final int totalCents;
  final String status;
  final String bookingStatus;
  final String date;
  final int hour;
  final String hourLabel;
  final String courtId;
  final String courtName;
  final String complexId;
  final String complexName;
  final String districtName;
  final String organizerName;
  final String progressLabel;
  final String whatsappUrl;
  final List<PaymentShareItem> shares;
  final Map<String, dynamic>? lastCharge;

  const SplitPaymentDetail({
    required this.id,
    required this.bookingId,
    required this.shareToken,
    required this.totalSlots,
    required this.paidSlots,
    required this.remainingSlots,
    required this.amountPerSlotCents,
    required this.totalCents,
    required this.status,
    required this.bookingStatus,
    required this.date,
    required this.hour,
    required this.hourLabel,
    required this.courtId,
    required this.courtName,
    required this.complexId,
    required this.complexName,
    required this.districtName,
    required this.organizerName,
    required this.progressLabel,
    required this.whatsappUrl,
    required this.shares,
    this.lastCharge,
  });

  factory SplitPaymentDetail.fromJson(Map<String, dynamic> json) {
    final total = (json['totalSlots'] as num?)?.toInt() ?? 6;
    final paid = (json['paidSlots'] as num?)?.toInt() ?? 0;
    return SplitPaymentDetail(
      id: (json['id'] ?? '').toString(),
      bookingId: (json['bookingId'] ?? '').toString(),
      shareToken: (json['shareToken'] ?? '').toString(),
      totalSlots: total,
      paidSlots: paid,
      remainingSlots: (json['remainingSlots'] as num?)?.toInt() ?? (total - paid),
      amountPerSlotCents: (json['amountPerSlotCents'] as num?)?.toInt() ?? 1500,
      totalCents: (json['totalCents'] as num?)?.toInt() ?? 9000,
      status: (json['status'] ?? 'OPEN').toString(),
      bookingStatus: (json['bookingStatus'] ?? 'HELD').toString(),
      date: (json['date'] ?? '').toString(),
      hour: (json['hour'] as num?)?.toInt() ?? 20,
      hourLabel: (json['hourLabel'] ?? '20:00').toString(),
      courtId: (json['courtId'] ?? '').toString(),
      courtName: (json['courtName'] ?? '').toString(),
      complexId: (json['complexId'] ?? '').toString(),
      complexName: (json['complexName'] ?? '').toString(),
      districtName: (json['districtName'] ?? '').toString(),
      organizerName: (json['organizerName'] ?? '').toString(),
      progressLabel: (json['progressLabel'] ?? 'Cupos pagados: $paid de $total').toString(),
      whatsappUrl: (json['whatsappUrl'] ?? '').toString(),
      shares: (json['shares'] as List?)
              ?.map((s) => PaymentShareItem.fromJson(Map<String, dynamic>.from(s as Map)))
              .toList() ??
          const [],
      lastCharge: json['lastCharge'] is Map ? Map<String, dynamic>.from(json['lastCharge'] as Map) : null,
    );
  }

  String get amountPerSlotSoles => (amountPerSlotCents / 100).toStringAsFixed(2);
}

class SubstituteProfile {
  final String id;
  final String userId;
  final String fullName;
  final String phoneMasked;
  final int trustScore;
  final String position;
  final int skillLevel;
  final double punctualityScore;
  final int matchesPlayed;
  final int noShows;
  final String districtCode;
  final String districtName;
  final String bio;
  final String clipUrl;
  final String clipPosterUrl;
  final int clipDurationS;
  final bool isVerified;
  final bool isAvailable;

  const SubstituteProfile({
    required this.id,
    required this.userId,
    required this.fullName,
    required this.phoneMasked,
    required this.trustScore,
    required this.position,
    required this.skillLevel,
    required this.punctualityScore,
    required this.matchesPlayed,
    required this.noShows,
    required this.districtCode,
    required this.districtName,
    required this.bio,
    required this.clipUrl,
    required this.clipPosterUrl,
    required this.clipDurationS,
    required this.isVerified,
    required this.isAvailable,
  });

  factory SubstituteProfile.fromJson(Map<String, dynamic> json) {
    return SubstituteProfile(
      id: (json['id'] ?? '').toString(),
      userId: (json['userId'] ?? '').toString(),
      fullName: (json['fullName'] ?? '').toString(),
      phoneMasked: (json['phoneMasked'] ?? '+51 9•• ••• •••').toString(),
      trustScore: (json['trustScore'] as num?)?.toInt() ?? 95,
      position: (json['position'] ?? 'ARQUERO').toString(),
      skillLevel: (json['skillLevel'] as num?)?.toInt() ?? 4,
      punctualityScore: double.tryParse((json['punctualityScore'] ?? '98.0').toString()) ?? 98.0,
      matchesPlayed: (json['matchesPlayed'] as num?)?.toInt() ?? 25,
      noShows: (json['noShows'] as num?)?.toInt() ?? 0,
      districtCode: (json['districtCode'] ?? 'CAYMA').toString(),
      districtName: (json['districtName'] ?? 'Cayma').toString(),
      bio: (json['bio'] ?? '').toString(),
      clipUrl: (json['clipUrl'] ?? '/media/clips/arquero.mp4').toString(),
      clipPosterUrl: (json['clipPosterUrl'] ?? '/media/player-arquero.jpg').toString(),
      clipDurationS: (json['clipDurationS'] as num?)?.toInt() ?? 20,
      isVerified: json['isVerified'] == true,
      isAvailable: json['isAvailable'] != false,
    );
  }
}

class RelayMessageItem {
  final String id;
  final String senderId;
  final String senderName;
  final String body;
  final bool redacted;
  final String createdAt;

  const RelayMessageItem({
    required this.id,
    required this.senderId,
    required this.senderName,
    required this.body,
    required this.redacted,
    required this.createdAt,
  });

  factory RelayMessageItem.fromJson(Map<String, dynamic> json) {
    return RelayMessageItem(
      id: (json['id'] ?? '').toString(),
      senderId: (json['senderId'] ?? '').toString(),
      senderName: (json['senderName'] ?? 'Usuario').toString(),
      body: (json['body'] ?? '').toString(),
      redacted: json['redacted'] == true,
      createdAt: (json['createdAt'] ?? '').toString(),
    );
  }
}
